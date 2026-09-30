/**
 * Supabase-native DB helpers — single source of truth (no Drizzle).
 * All data access via Supabase service-role client or raw postgres (getSql) for transactions.
 */
import { ENV } from "../config/env";
import { getSupabaseAdmin, getSql } from "../db/supabase";

// Staff role type (mirrors public.staff.role)
export type StaffRole = "owner" | "manager" | "staff";

export type InsertUser = {
  openId: string;
  name?: string | null;
  email?: string | null;
  loginMethod?: string | null;
  role?: "user" | "admin";
  lastSignedIn?: Date;
};

// Re-export the raw SQL accessor for routers that need transactions.
export { getSql };

// Timeout for best-effort writes (audit): fail fast, fall back to SQL.
//
// Measured: with a 10s window, a login took ~10.5s because the PostgREST audit
// insert sat in that window before falling back to direct SQL (which takes
// ~0.4s). Audit is explicitly best-effort, so waiting long for it is never
// worth it. Callers that need the row to exist should not be on this path.
const AUDIT_TIMEOUT_MS = 2000;
function withTimeout<T>(
  p: PromiseLike<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
  });
  return Promise.race([Promise.resolve(p), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const supabase = getSupabaseAdmin();
  const values: any = {
    openId: user.openId,
    lastSignedIn: (user.lastSignedIn ?? new Date()).toISOString(),
  };
  for (const field of ["name", "email", "loginMethod"] as const) {
    if ((user as any)[field] !== undefined)
      values[field] = (user as any)[field] ?? null;
  }
  if ((user as any).role !== undefined) values.role = (user as any).role;
  else if (user.openId === ENV.ownerOpenId) values.role = "admin";
  const { error } = await supabase
    .from("users")
    .upsert(values, { onConflict: "openId" });
  if (error) throw error;
}

export async function getUserByOpenId(openId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("openId", openId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as any) ?? undefined;
}

// Short-lived per-process memo to avoid N+1 auth queries within a batch (30s TTL).
const staffRoleMemo = new Map<
  string,
  { value: StaffRole | null; expires: number }
>();
const outletScopeMemo = new Map<
  string,
  { value: number[] | null; expires: number }
>();
const MEMO_TTL = 30_000;

function memoKey(user: {
  id: number;
  role: "user" | "admin";
  email?: string | null;
}): string {
  return `${user.id}:${user.role}:${user.email ?? ""}`;
}

/**
 * Drop memoized role/outlet state for a user.
 *
 * The memos have a 30s TTL purely to avoid N+1 queries within a batch, but that
 * also meant a demotion, suspension or outlet reassignment did not take effect
 * for up to 30 seconds — long enough for a removed manager to keep issuing
 * authorized requests. Every write path that changes a staff role, status,
 * active flag or outlet assignment calls this so revocation is immediate.
 *
 * Only clears the local process: with several instances each one clears its own
 * memo when it performs the write. Other instances fall back to their TTL.
 */
export function invalidateAuthMemo(
  user: { id?: number | null; email?: string | null } | null | undefined
): void {
  if (!user) return;
  if (user.id != null) {
    const id = String(user.id);
    for (const k of Array.from(staffRoleMemo.keys()))
      if (k.startsWith(`${id}:`)) staffRoleMemo.delete(k);
    for (const k of Array.from(outletScopeMemo.keys()))
      if (k.startsWith(`${id}:`)) outletScopeMemo.delete(k);
  }
  if (user.email) {
    const needle = `:${user.email}`;
    for (const k of Array.from(staffRoleMemo.keys()))
      if (k.endsWith(needle)) staffRoleMemo.delete(k);
    for (const k of Array.from(outletScopeMemo.keys()))
      if (k.endsWith(needle)) outletScopeMemo.delete(k);
  }
}

export async function resolveStaffRole(user: {
  id: number;
  role: "user" | "admin";
  email?: string | null;
}): Promise<StaffRole | null> {
  if (user.role === "admin") return "owner";
  const key = memoKey(user);
  const cached = staffRoleMemo.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const supabase = getSupabaseAdmin();
  const { data: byUser } = await supabase
    .from("staff")
    .select("id,userId,role,status,active")
    .eq("userId", user.id)
    .eq("active", true)
    .limit(1);
  let member: any = (byUser as any)?.[0];
  if (!member && user.email) {
    const { data: byEmail } = await supabase
      .from("staff")
      .select("id,userId,role,status,active")
      .is("userId", null)
      .eq("email", user.email)
      .eq("active", true)
      .limit(1);
    member = (byEmail as any)?.[0];
  }
  if (!member) {
    staffRoleMemo.set(key, { value: null, expires: Date.now() + MEMO_TTL });
    return null;
  }
  if (
    member.status &&
    !["active", "on_leave"].includes(member.status as string)
  ) {
    staffRoleMemo.set(key, { value: null, expires: Date.now() + MEMO_TTL });
    return null;
  }
  if (member.userId === null) {
    await supabase
      .from("staff")
      .update({ userId: user.id } as any)
      .eq("id", member.id);
  }
  const v = member?.role ?? null;
  staffRoleMemo.set(key, { value: v, expires: Date.now() + MEMO_TTL });
  return v;
}

import {
  ROLE_PERMISSIONS as SHARED_PERMS,
  type Permission,
  roleCan as sharedRoleCan,
} from "@shared/permissions";
export type { Permission };
export const rolePermissions: Record<StaffRole, Permission[]> =
  SHARED_PERMS as Record<StaffRole, Permission[]>;

export function roleCan(
  role: StaffRole,
  action:
    | "orders"
    | "menu"
    | "loyalty"
    | "analytics"
    | "staff"
    | "settings"
    | "inventory"
    | Permission
) {
  if (!action.includes(".")) {
    const legacyMap: Record<string, Permission[]> = {
      orders: ["orders.read"],
      menu: ["menu.read"],
      loyalty: ["loyalty.read"],
      analytics: ["analytics.read"],
      staff: ["staff.read"],
      settings: ["settings.read"],
      inventory: ["inventory.read"],
    };
    const needed = legacyMap[action];
    if (needed) return rolePermissions[role].some(p => needed.includes(p));
    return false;
  }
  return sharedRoleCan(role, action as string);
}

export function hasPermission(role: StaffRole, perm: Permission) {
  return sharedRoleCan(role, perm);
}

export async function getOutletScope(user: {
  id: number;
  role: "user" | "admin";
  email?: string | null;
}): Promise<number[] | null> {
  if (user.role === "admin") return null;
  const role = await resolveStaffRole(user);
  if (role === "owner") return null;
  const key = memoKey(user) + ":scope";
  const cached = outletScopeMemo.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const supabase = getSupabaseAdmin();
  let member: any = null;
  const { data: byUser } = await supabase
    .from("staff")
    .select("id")
    .eq("userId", user.id)
    .limit(1);
  member = (byUser as any)?.[0];
  if (!member && user.email) {
    const { data: byEmail } = await supabase
      .from("staff")
      .select("id")
      .is("userId", null)
      .eq("email", user.email)
      .limit(1);
    member = (byEmail as any)?.[0];
  }
  if (!member) {
    const v: number[] = [];
    outletScopeMemo.set(key, { value: v, expires: Date.now() + MEMO_TTL });
    return v;
  }
  const { data: assignments } = await supabase
    .from("outlet_staff")
    .select("outletId")
    .eq("staffId", member.id);
  if (!assignments || assignments.length === 0) {
    const v: number[] = [];
    outletScopeMemo.set(key, { value: v, expires: Date.now() + MEMO_TTL });
    return v;
  }
  const v = (assignments as any[]).map(r => r.outletId);
  outletScopeMemo.set(key, { value: v, expires: Date.now() + MEMO_TTL });
  return v;
}

export async function assertOutletAccess(
  user: { id: number; role: "user" | "admin"; email?: string | null },
  outletId?: number | null
) {
  if (!outletId) return;
  const scope = await getOutletScope(user);
  if (scope === null) return;
  if (!scope.includes(outletId)) {
    const { TRPCError } = await import("@trpc/server");
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this outlet.",
    });
  }
}

/**
 * `order_items.selectedModifiers` is a `json` column, so it can legitimately
 * hold anything JSON-shaped. Older rows written through the public checkout
 * stored the *string* "[]" rather than an array, which crashed the Admin order
 * dialog with "item.selectedModifiers.map is not a function".
 *
 * Every read path funnels through here so a malformed legacy row degrades to an
 * empty modifier list instead of taking down the whole panel.
 */
export function normalizeSelectedModifiers(
  value: unknown
): Array<{ name: string; priceDelta: number }> {
  let raw = value;
  // Unwrap the doubly-encoded case: the column holds the JSON string "[]".
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) {
    return raw
      .filter(
        (m): m is Record<string, unknown> => Boolean(m) && typeof m === "object"
      )
      .map(m => ({
        name: String(m.name ?? ""),
        priceDelta: Number(m.priceDelta ?? 0),
      }));
  }
  // A bare object was also seen in older data; treat it as a single modifier.
  if (raw && typeof raw === "object") {
    return [
      {
        name: String((raw as any).name ?? ""),
        priceDelta: Number((raw as any).priceDelta ?? 0),
      },
    ];
  }
  return [];
}

// Escape user input embedded in PostgREST `.or(...)` / `.ilike(...)` filters.
// PostgREST parses commas as filter separators and parentheses/quotes as
// grouping, so escaping only `%` still allows filter-grammar injection
// (over-broad reads). Backslash-escapes every grammar-significant char.
export function escapePostgrestOr(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/,/g, "\\,")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/"/g, '\\"');
}

// Canonical pricing: base + modifiers + qty → subtotal → discount → tax → charges → total
export function calculateOrderTotal(input: {
  lines: Array<{
    quantity: number;
    unitPrice: number;
    modifiersTotal?: number;
  }>;
  discount?: {
    type: "percentage" | "fixed";
    value: number;
    maxDiscount?: number;
  };
  taxes?: Array<{ rate: number; enabled: boolean }>;
  charges?: { service?: number; packaging?: number; delivery?: number };
}) {
  const subtotal = input.lines.reduce(
    (sum, l) => sum + (l.unitPrice + (l.modifiersTotal ?? 0)) * l.quantity,
    0
  );
  let discountAmount = 0;
  if (input.discount) {
    if (input.discount.type === "percentage") {
      discountAmount = subtotal * (input.discount.value / 100);
      if (input.discount.maxDiscount)
        discountAmount = Math.min(discountAmount, input.discount.maxDiscount);
    } else discountAmount = Math.min(input.discount.value, subtotal);
  }
  const taxable = subtotal - discountAmount;
  let taxTotal = 0;
  for (const t of input.taxes ?? [])
    if (t.enabled) taxTotal += taxable * (t.rate / 100);
  const chargesTotal =
    (input.charges?.service ?? 0) +
    (input.charges?.packaging ?? 0) +
    (input.charges?.delivery ?? 0);
  return {
    subtotal,
    discountAmount,
    taxable,
    taxTotal,
    chargesTotal,
    total: taxable + taxTotal + chargesTotal,
  };
}

export async function recordAudit(input: {
  /** null for system/unauthenticated events (e.g. a failed login for an
   *  address with no account). `audit_log.actorUserId` is nullable and
   *  foreign-keyed — passing 0 would violate the constraint and silently drop
   *  the audit row. */
  actorUserId: number | null;
  entityType: string;
  entityId?: number | null;
  outletId?: number | null;
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Resolved client IP. `audit_log.ip_address` is `inet`, so only real
   *  addresses or null are written — never the "unknown" sentinel. */
  ip?: string | null;
  userAgent?: string | null;
  success?: boolean;
}) {
  // Best-effort: audit must never hang or break a request. REST gets a
  // timeout with direct-SQL fallback; failures are logged, not thrown.
  const ip =
    input.ip && input.ip !== "unknown" && input.ip.length <= 45
      ? input.ip
      : null;
  const row = {
    actorUserId: input.actorUserId,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    outletId: input.outletId ?? null,
    action: input.action,
    before: input.before as any,
    after: input.after as any,
    ip_address: ip,
    user_agent: (input.userAgent ?? "").slice(0, 512) || null,
    success: input.success ?? null,
  } as any;
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await withTimeout(
      supabase.from("audit_log").insert(row),
      AUDIT_TIMEOUT_MS,
      "audit_log insert"
    );
    if (error) throw error;
  } catch {
    try {
      const sql = await getSql();
      await sql.unsafe(
        `INSERT INTO audit_log ("actorUserId","entityType","entityId","outletId","action","before","after","ip_address","user_agent","success")
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::inet,$9,$10)`,
        [
          row.actorUserId,
          row.entityType,
          row.entityId,
          row.outletId,
          row.action,
          JSON.stringify(row.before ?? null),
          JSON.stringify(row.after ?? null),
          ip,
          row.user_agent,
          input.success ?? null,
        ]
      );
    } catch (e) {
      console.warn(
        "[audit] recordAudit failed (best-effort, request continues):",
        (e as Error)?.message ?? e
      );
    }
  }
}

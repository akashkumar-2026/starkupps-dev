/** Kitchen Ledger API: validated, role-aware tRPC procedures for operational admin workflows. Migrated to Supabase. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  assertOutletAccess,
  escapePostgrestOr,
  getOutletScope,
  hasPermission,
  normalizeSelectedModifiers,
  recordAudit,
  resolveStaffRole,
  roleCan,
} from "../db/index";
import { protectedProcedure, router } from "../lib/trpc";
import { getSql, getSupabaseAdmin } from "../db/supabase";
import { ENV } from "../config/env";

type StaffRole = "staff" | "manager" | "owner";

const orderStatusSchema = z.enum([
  "new",
  "preparing",
  "ready",
  "completed",
  "cancelled",
]);
const orderTypeSchema = z.enum(["dine_in", "takeaway", "delivery"]);
const paginationSchema = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.number().int().positive().optional(),
  search: z.string().trim().max(160).optional(),
});
const roleRank: Record<StaffRole, number> = { staff: 1, manager: 2, owner: 3 };

const variantInputSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(120),
  quantity: z.number().positive().max(1_000_000).nullable().optional(),
  unit: z.string().trim().max(24).nullable().optional(),
  price: z.number().positive().max(1_000_000),
  sku: z.string().trim().max(80).nullable().optional(),
  available: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

const variantsArraySchema = z.array(variantInputSchema).min(1).max(20);

const imageUrlSchema = z
  .string()
  .trim()
  .max(7000000)
  .nullable()
  .optional()
  .refine(
    val => {
      if (!val) return true;
      try {
        const u = new URL(val);
        return ["http:", "https:", "data:"].includes(u.protocol);
      } catch {
        return false;
      }
    },
    { message: "Image URL is not valid — must be https://…" }
  );

function normalizeUnit(u: string | null | undefined): string | null {
  if (!u) return null;
  const t = u.trim();
  return t ? t.slice(0, 24) : null;
}

function validateVariantsPayload(
  variants: z.infer<typeof variantInputSchema>[]
) {
  if (!variants.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "At least one size/variant is required",
    });
  const seen = new Set<string>();
  for (const v of variants) {
    const key = v.name.trim().toLowerCase();
    if (seen.has(key))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Duplicate variant name "${v.name}"`,
      });
    seen.add(key);
    if (
      v.quantity !== null &&
      v.quantity !== undefined &&
      (isNaN(v.quantity) || v.quantity <= 0)
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid quantity for variant "${v.name}"`,
      });
    if (v.price !== null && (isNaN(v.price) || v.price <= 0))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid price for variant "${v.name}"`,
      });
    if (v.sku) {
      const sku = v.sku.trim();
      if (sku.length < 2)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `SKU too short for variant "${v.name}"`,
        });
    }
  }
  const skuSeen = new Set<string>();
  for (const v of variants) {
    if (!v.sku) continue;
    const sku = v.sku.trim();
    if (skuSeen.has(sku.toLowerCase()))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Duplicate SKU "${sku}" within variants`,
      });
    skuSeen.add(sku.toLowerCase());
  }
  const defaults = variants.filter(v => v.isDefault);
  if (defaults.length === 0) {
    variants[0].isDefault = true;
  } else if (defaults.length > 1) {
    let first = true;
    for (const v of variants) {
      if (v.isDefault) {
        if (first) first = false;
        else v.isDefault = false;
      }
    }
  }
  variants.sort(
    (a, b) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)
  );
  variants.forEach((v, i) => (v.sortOrder = i));
  return variants;
}

async function checkSkuUniqueness(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  variants: z.infer<typeof variantInputSchema>[],
  excludeIds: number[] = []
) {
  const skus = variants.map(v => v.sku?.trim()).filter(Boolean) as string[];
  if (!skus.length) return;
  // Use ilike-insensitive check via fetching candidates; Supabase doesn't have case-insensitive in directly for array, so fetch all matching case-insensitively via ilike or via getSql
  try {
    const sql = await getSql();
    // Use parameterized query for case-insensitive check
    const params: any[] = [...skus];
    // lower(sku) in (lower($1), lower($2)...)
    const rows: any[] = await sql.unsafe(
      `SELECT "sku","id" FROM "menu_item_variants" WHERE lower("sku") IN (${skus.map((_, i) => `lower($${i + 1})`).join(",")})`,
      params
    );
    for (const row of rows) {
      if (excludeIds.includes(row.id)) continue;
      if (skus.some(s => s.toLowerCase() === String(row.sku).toLowerCase())) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `SKU "${row.sku}" already in use by another variant`,
        });
      }
    }
    return;
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    // fallback via supabase client (case-insensitive manual)
    const { data } = await supabase
      .from("menu_item_variants")
      .select("sku,id")
      .in("sku", skus);
    const existing = (data ?? []) as any[];
    for (const row of existing) {
      if (excludeIds.includes(row.id)) continue;
      if (skus.some(s => s.toLowerCase() === String(row.sku).toLowerCase())) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `SKU "${row.sku}" already in use by another variant`,
        });
      }
    }
    // also need to catch case-different duplicates not returned by in (case-sensitive), so fetch all skus and compare lowercased?
    // fallback: fetch all variants with sku not null and check in JS if needed and no match yet
    // but above covers most; do second pass fetching all where sku ilike any?
    if (!existing.length) {
      // No direct match, but could be case-different; fetch all and check lowercased intersection?
      // For safety, fetch all variant skus when suspicious
      const { data: all } = await supabase
        .from("menu_item_variants")
        .select("sku,id")
        .not("sku", "is", null);
      for (const row of (all ?? []) as any[]) {
        if (excludeIds.includes(row.id)) continue;
        if (skus.some(s => s.toLowerCase() === String(row.sku).toLowerCase())) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `SKU "${row.sku}" already in use by another variant`,
          });
        }
      }
    }
  }
}

async function syncVariantsForItem(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  menuItemId: number,
  variants: z.infer<typeof variantInputSchema>[]
) {
  const payload = validateVariantsPayload([...variants]);
  await checkSkuUniqueness(supabase, payload);
  const { data: existingRaw } = await supabase
    .from("menu_item_variants")
    .select("*")
    .eq("menuItemId", menuItemId);
  const existing = (existingRaw ?? []) as any[];
  const existingById = new Map<number, any>(
    existing.map((r: any) => [r.id, r])
  );
  const payloadIds = new Set(payload.filter(v => v.id).map(v => v.id!));
  const toDelete = existing.filter((r: any) => !payloadIds.has(r.id));
  for (const r of toDelete) {
    const { error } = await supabase
      .from("menu_item_variants")
      .delete()
      .eq("id", r.id);
    if (error)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error.message,
      });
  }
  for (const v of payload) {
    const data: any = {
      menuItemId,
      name: v.name.trim(),
      quantity: v.quantity ?? null,
      unit: normalizeUnit(v.unit),
      price: v.price,
      sku: v.sku?.trim() || null,
      available: v.available,
      isDefault: v.isDefault,
      sortOrder: v.sortOrder,
    };
    if (v.id && existingById.has(v.id)) {
      const { error } = await supabase
        .from("menu_item_variants")
        .update(data)
        .eq("id", v.id);
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
    } else {
      const { data: ins, error } = await supabase
        .from("menu_item_variants")
        .insert(data)
        .select("id")
        .single();
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      void ins;
    }
  }
  const { data: afterRaw } = await supabase
    .from("menu_item_variants")
    .select("*")
    .eq("menuItemId", menuItemId);
  const after = (afterRaw ?? []) as any[];
  if (after.length) {
    const defaults = after.filter((r: any) => r.isDefault);
    if (defaults.length !== 1) {
      const sorted = after.sort((a: any, b: any) => a.sortOrder - b.sortOrder);
      for (let i = 0; i < sorted.length; i++) {
        const shouldBe = i === 0;
        if (Boolean(sorted[i].isDefault) !== shouldBe) {
          const { error } = await supabase
            .from("menu_item_variants")
            .update({ isDefault: shouldBe } as any)
            .eq("id", sorted[i].id);
          if (error)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
            });
        }
      }
    }
  }
}

async function requirePermission(
  user: { id: number; role: "user" | "admin" },
  capability: Parameters<typeof roleCan>[1]
) {
  const role = await resolveStaffRole(user);
  if (!role || !roleCan(role, capability))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your staff role does not have access to this operation.",
    });
  return role;
}

async function requireOwner(user: { id: number; role: "user" | "admin" }) {
  const role = await resolveStaffRole(user);
  if (!role || roleRank[role as StaffRole] < roleRank.owner)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Owner access is required for this operation.",
    });
  return role;
}

function decimal(value: unknown) {
  return Number(value ?? 0);
}

// Detect image type from magic bytes. Returns the canonical MIME or null.
// The declared contentType is never trusted on its own.
function sniffImageMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return "image/jpeg";
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  )
    return "image/png";
  const head6 = buffer.subarray(0, 6).toString("ascii");
  if (head6 === "GIF87a" || head6 === "GIF89a") return "image/gif";
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  if (
    buffer.subarray(4, 8).toString("ascii") === "ftyp" &&
    buffer.subarray(8, 12).toString("ascii").startsWith("avif")
  )
    return "image/avif";
  return null;
}

function assertImageBytes(buffer: Buffer, declared: string): void {
  const detected = sniffImageMime(buffer);
  if (!detected)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "File is not a recognized image (JPEG, PNG, WebP, GIF, AVIF).",
    });
  const norm = (m: string) => (m === "image/jpg" ? "image/jpeg" : m);
  if (norm(detected) !== norm(declared)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Image content does not match declared type (detected ${detected}).`,
    });
  }
}

async function orderDetail(orderId: number) {
  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return null;
  }
  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .limit(1)
    .maybeSingle();
  if (error)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
    });
  if (!order) return null;
  let customerName: string | null = null;
  let customerPhone: string | null = null;
  if ((order as any).customerId) {
    const { data: cust } = await supabase
      .from("customers")
      .select("name,phone")
      .eq("id", (order as any).customerId)
      .limit(1)
      .maybeSingle();
    customerName = (cust as any)?.name ?? null;
    customerPhone = (cust as any)?.phone ?? null;
  }
  const { data: linesRaw, error: linesErr } = await supabase
    .from("order_items")
    .select("*")
    .eq("orderId", orderId);
  if (linesErr)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: linesErr.message,
    });
  const lines = (linesRaw ?? []) as any[];
  return {
    ...(order as any),
    customerName,
    customerPhone,
    subtotal: decimal((order as any).subtotal),
    total: decimal((order as any).total),
    items: lines.map((line: any) => ({
      ...line,
      selectedModifiers: normalizeSelectedModifiers(line.selectedModifiers),
      lineTotal: decimal(line.lineTotal),
      unitPrice: line.unitPrice != null ? decimal(line.unitPrice) : null,
      variantQuantity:
        line.variantQuantity != null ? decimal(line.variantQuantity) : null,
    })),
  };
}

export const adminRouter = router({
  bootstrap: protectedProcedure.query(async ({ ctx }) => {
    // This was `protectedProcedure`-only: any valid session could read the
    // active shift and the full store_settings row (global, all-outlet) with no
    // role check. Require an active staff record, matching every other
    // operational read, and fail closed rather than degrading to "no role".
    const staffRole = await resolveStaffRole(ctx.user);
    if (!staffRole) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "Your account is not authorized to access the StarKupps Operations Panel.",
      });
    }
    if (!hasPermission(staffRole, "orders.read")) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
    }
    try {
      const supabase = getSupabaseAdmin();
      const withTimeout = <T>(p: Promise<T>, ms = 1800): Promise<T> =>
        Promise.race([
          p,
          new Promise<T>((_, rej) =>
            setTimeout(() => rej(new Error("timeout")), ms)
          ),
        ]) as Promise<T>;
      const shiftP: Promise<any> = supabase
        .from("shifts")
        .select("*")
        .eq("active", true)
        .order("startedAt", { ascending: false })
        .limit(1) as any;
      const settingsP: Promise<any> = supabase
        .from("store_settings")
        .select("*")
        .limit(1) as any;
      const [shiftRes, settingsRes] = await Promise.all([
        withTimeout(shiftP.catch(() => ({ data: null }))),
        withTimeout(settingsP.catch(() => ({ data: null }))),
      ]);
      return {
        staffRole,
        activeShift: ((shiftRes as any)?.data?.[0] as any) ?? null,
        settings: ((settingsRes as any)?.data?.[0] as any) ?? null,
      };
    } catch {
      return { staffRole, activeShift: null, settings: null };
    }
  }),

  dashboard: protectedProcedure
    .input(
      z
        .object({
          from: z.date().optional(),
          to: z.date().optional(),
          shiftId: z.number().int().positive().optional(),
          outletId: z.number().int().positive().optional(),
        })
        .nullish()
    )
    .query(async ({ ctx, input }) => {
      await requirePermission(ctx.user, "orders");
      const { getOutletScope } = await import("../db/index");
      const scope = await getOutletScope(ctx.user);
      if (scope !== null && scope.length === 0)
        return {
          openCount: 0,
          totalRevenue: 0,
          servedCount: 0,
          averagePrepMinutes: 0,
          repeatRate: 0,
        };
      if (input?.outletId) {
        const { assertOutletAccess } = await import("../db/index");
        await assertOutletAccess(ctx.user, input.outletId);
      }
      const supabase = getSupabaseAdmin();
      // Bound the scan: with no explicit range the dashboard evaluates the last
      // 30 days (with a hard cap) instead of loading the entire order history.
      const to = input?.to ?? new Date();
      const from = input?.from ?? new Date(to.getTime() - 30 * 86_400_000);
      let query = supabase
        .from("orders")
        .select("*")
        .gte("createdAt", from.toISOString())
        .lte("createdAt", to.toISOString())
        .order("createdAt", { ascending: false })
        .limit(20_000);
      if (input?.shiftId) query = query.eq("shiftId", input.shiftId);
      if (input?.outletId) query = query.eq("outletId", input.outletId);
      else if (scope !== null) {
        if (scope.length === 1) query = query.eq("outletId", scope[0]);
        else query = query.in("outletId", scope);
      }
      const { data: orderRowsRaw, error } = await query;
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      const orderRows = (orderRowsRaw ?? []) as any[];
      const paid = orderRows.filter(
        (order: any) =>
          order.paymentStatus === "paid" && order.status !== "cancelled"
      );
      const openCount = orderRows.filter((order: any) =>
        ["new", "preparing", "ready"].includes(order.status)
      ).length;
      const totalRevenue = paid.reduce(
        (sum: number, order: any) => sum + decimal(order.total),
        0
      );
      const completed = orderRows.filter(
        (order: any) => order.status === "completed"
      );
      const prepMinutes = completed.map((order: any) =>
        Math.max(
          0,
          (new Date(order.updatedAt).getTime() -
            new Date(order.createdAt).getTime()) /
            60_000
        )
      );
      const customerIds = paid
        .map((order: any) => order.customerId)
        .filter((id: any): id is number => id !== null && id !== undefined);
      let repeatRows: any[] = [];
      if (customerIds.length) {
        try {
          const sql = await getSql();
          // Aggregate via raw sql for repeat detection, scoped to the customers
          // seen in this range rather than scanning the full order history.
          repeatRows = await sql.unsafe(
            `SELECT "customerId", count(*)::int as count FROM "orders" WHERE "customerId" = ANY($1) AND "status" != 'cancelled' GROUP BY "customerId"`,
            [customerIds]
          );
        } catch {
          // fallback via supabase client: fetch all relevant orders and group in JS
          const { data: allForRepeat } = await supabase
            .from("orders")
            .select("customerId,status")
            .not("customerId", "is", null)
            .neq("status", "cancelled");
          const countMap = new Map<number, number>();
          for (const r of (allForRepeat ?? []) as any[]) {
            countMap.set(r.customerId, (countMap.get(r.customerId) ?? 0) + 1);
          }
          repeatRows = Array.from(countMap.entries()).map(
            ([customerId, count]) => ({ customerId, count })
          );
        }
      }
      const repeatCustomerIds = new Set(
        repeatRows
          .filter(row => Number(row.count) > 1)
          .map(row => row.customerId)
      );
      const repeatRate = customerIds.length
        ? (customerIds.filter(id => repeatCustomerIds.has(id)).length /
            customerIds.length) *
          100
        : 0;
      return {
        openCount,
        totalRevenue,
        servedCount: completed.length,
        averagePrepMinutes: prepMinutes.length
          ? prepMinutes.reduce(
              (sum: number, minutes: number) => sum + minutes,
              0
            ) / prepMinutes.length
          : 0,
        repeatRate,
      };
    }),

  orders: router({
    list: protectedProcedure
      .input(
        paginationSchema.extend({
          status: orderStatusSchema.optional(),
          shiftId: z.number().int().positive().optional(),
          outletId: z.number().int().positive().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        await requirePermission(ctx.user, "orders");
        const { getOutletScope, assertOutletAccess: assertOA } =
          await import("../db/index");
        const scope = await getOutletScope(ctx.user);
        if (scope !== null && scope.length === 0)
          return { items: [], nextCursor: undefined };
        if (input.outletId) await assertOA(ctx.user, input.outletId);
        const supabase = getSupabaseAdmin();
        // Complex join with customers and search -> use getSql.unsafe when search involved, fallback to supabase for simple
        const limitPlusOne = input.limit + 1;
        if (input.search) {
          try {
            const sql = await getSql();
            const params: any[] = [];
            let idx = 1;
            const conditions: string[] = [];
            if (input.cursor) {
              conditions.push(`o."id" < $${idx++}`);
              params.push(input.cursor);
            }
            if (input.status) {
              conditions.push(`o."status" = $${idx++}`);
              params.push(input.status);
            }
            if (input.shiftId) {
              conditions.push(`o."shiftId" = $${idx++}`);
              params.push(input.shiftId);
            }
            if (input.outletId) {
              conditions.push(`o."outletId" = $${idx++}`);
              params.push(input.outletId);
            } else if (scope !== null) {
              if (scope.length === 0) {
                return { items: [], nextCursor: undefined };
              }
              if (scope.length === 1) {
                conditions.push(`o."outletId" = $${idx++}`);
                params.push(scope[0]);
              } else {
                conditions.push(`o."outletId" = ANY($${idx++})`);
                params.push(scope);
              }
            }
            if (input.search) {
              const like = `%${input.search}%`;
              conditions.push(
                `(o."orderNumber"::text ILIKE $${idx} OR c."name" ILIKE $${idx} OR c."phone" ILIKE $${idx})`
              );
              params.push(like);
              idx++;
            }
            const where = conditions.length
              ? `WHERE ${conditions.join(" AND ")}`
              : "";
            const rows: any[] = await sql.unsafe(
              `
            SELECT o.*, c."name" as "customerName", c."phone" as "customerPhone"
            FROM "orders" o
            LEFT JOIN "customers" c ON o."customerId" = c."id"
            ${where}
            ORDER BY o."id" DESC
            LIMIT $${idx++}
          `,
              [...params, limitPlusOne]
            );
            const page = rows.slice(0, input.limit).map((row: any) => ({
              ...row,
              total: decimal(row.total),
              subtotal: decimal(row.subtotal),
              customerName: row.customerName,
              customerPhone: row.customerPhone,
            }));
            return {
              items: page,
              nextCursor:
                rows.length > input.limit ? page.at(-1)?.id : undefined,
            };
          } catch (e) {
            // fallback to supabase client without sql
          }
        }
        // Supabase client path (no search with join complexity OR fallback)
        let query = supabase
          .from("orders")
          .select("*")
          .order("id", { ascending: false })
          .limit(limitPlusOne);
        if (input.cursor) query = query.lt("id", input.cursor);
        if (input.status) query = query.eq("status", input.status);
        if (input.shiftId) query = query.eq("shiftId", input.shiftId);
        if (input.outletId) query = query.eq("outletId", input.outletId);
        else if (scope !== null) {
          if (scope.length === 0) return { items: [], nextCursor: undefined };
          if (scope.length === 1) query = query.eq("outletId", scope[0]);
          else query = query.in("outletId", scope);
        }
        // Search handling for supabase path: need to support orderNumber search via separate filter, and customer name/phone via batch fetch
        let searchCustomerIds: number[] | null = null;
        if (input.search) {
          const likePattern = `%${escapePostgrestOr(input.search)}%`;
          // Try to find matching customers
          const { data: matchedCustomers } = await supabase
            .from("customers")
            .select("id")
            .or(`name.ilike.${likePattern},phone.ilike.${likePattern}`);
          searchCustomerIds = (matchedCustomers ?? []).map((c: any) => c.id);
          // Also allow orderNumber partial match - we'll filter in JS after fetch if needed, or use ilike via or on orders
          // For simplicity, we will fetch and filter in JS when search is present
        }
        const { data: orderDataRaw, error } = await query;
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        let rowsRaw = (orderDataRaw ?? []) as any[];
        if (input.search) {
          const q = input.search.toLowerCase();
          rowsRaw = rowsRaw.filter(
            (o: any) =>
              String(o.orderNumber).toLowerCase().includes(q) ||
              (searchCustomerIds && searchCustomerIds.includes(o.customerId))
          );
          // If search filter removed many rows, we may need to fetch more - for simplicity, slice after filter; nextCursor handling remains approximate
          // To preserve pagination correctness when search is used without sql, we rely on sql path above; this is fallback
        }
        // Enrich with customer names
        const customerIds = Array.from(
          new Set(rowsRaw.map((o: any) => o.customerId).filter(Boolean))
        );
        const customerMap = new Map<number, any>();
        if (customerIds.length) {
          const { data: custs } = await supabase
            .from("customers")
            .select("id,name,phone")
            .in("id", customerIds);
          for (const c of (custs ?? []) as any[]) customerMap.set(c.id, c);
        }
        const enriched = rowsRaw.map((o: any) => ({
          ...o,
          total: decimal(o.total),
          subtotal: decimal(o.subtotal),
          customerName: o.customerId
            ? (customerMap.get(o.customerId)?.name ?? null)
            : null,
          customerPhone: o.customerId
            ? (customerMap.get(o.customerId)?.phone ?? null)
            : null,
        }));
        const page = enriched.slice(0, input.limit);
        return {
          items: page,
          nextCursor:
            rowsRaw.length > input.limit ? page.at(-1)?.id : undefined,
        };
      }),
    create: protectedProcedure
      .input(
        z.object({
          orderNumber: z.number().int().positive().max(999_999_999),
          outletId: z.number().int().positive().optional(),
          type: orderTypeSchema,
          customer: z
            .object({
              name: z.string().trim().min(1).max(160).nullable(),
              phone: z.string().trim().min(8).max(32).nullable(),
            })
            .nullable(),
          notes: z.string().trim().max(1_000).nullable(),
          items: z
            .array(
              z.object({
                menuItemId: z.number().int().positive().nullable(),
                variantId: z.number().int().positive().nullable().optional(),
                itemName: z.string().trim().min(1).max(160),
                quantity: z.number().int().min(1).max(99),
                lineTotal: z.number().positive().max(1_000_000),
                selectedModifiers: z
                  .array(
                    z.object({
                      name: z.string().min(1).max(120),
                      priceDelta: z.number().min(-1_000_000).max(1_000_000),
                    })
                  )
                  .max(30)
                  .nullable(),
              })
            )
            .min(1)
            .max(40),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx.user, "orders.create");
        const supabase = getSupabaseAdmin();

        // Resolve the target outlet and enforce outlet authorization. A user with
        // global scope (owner/admin) must choose an outlet explicitly; a scoped
        // user with exactly one outlet may omit it.
        let outletId = input.outletId ?? null;
        if (outletId !== null) await assertOutletAccess(ctx.user, outletId);
        const scope = await getOutletScope(ctx.user);
        if (outletId === null && scope !== null) {
          if (scope.length === 1) outletId = scope[0];
          else if (scope.length === 0)
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "No outlet is assigned to your account.",
            });
        }
        if (outletId === null)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Select an outlet for this ticket.",
          });
        const { data: outletRow, error: outletErr } = await supabase
          .from("outlets")
          .select("id")
          .eq("id", outletId)
          .limit(1)
          .maybeSingle();
        if (outletErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: outletErr.message,
          });
        if (!outletRow)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "The selected outlet no longer exists.",
          });

        const { data: settingsData } = await supabase
          .from("store_settings")
          .select("openForOrders,autoAcceptOrders")
          .limit(1);
        const settings = (settingsData?.[0] as any) ?? null;
        if (!settings?.openForOrders)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Order intake is paused in Store Settings.",
          });
        const { data: activeShiftData } = await supabase
          .from("shifts")
          .select("id")
          .eq("active", true)
          .order("startedAt", { ascending: false })
          .limit(1);
        const activeShift = (activeShiftData?.[0] as any) ?? null;
        const subtotal = input.items.reduce(
          (sum, item) => sum + item.lineTotal,
          0
        );
        const status = settings.autoAcceptOrders
          ? ("preparing" as const)
          : ("new" as const);

        // All order writes happen in one transaction so a failure can never leave
        // an order header without its lines (or vice versa).
        const sql = await getSql();
        let id: number;
        try {
          id = await sql.begin(async (tx: any) => {
            let customerId: number | null = null;
            if (input.customer?.phone) {
              const found: any[] =
                await tx`SELECT "id","name" FROM "customers" WHERE "phone" = ${input.customer.phone} LIMIT 1`;
              if (found[0]) {
                customerId = Number(found[0].id);
                if (
                  input.customer.name &&
                  input.customer.name !== found[0].name
                ) {
                  await tx`UPDATE "customers" SET "name" = ${input.customer.name} WHERE "id" = ${customerId}`;
                }
              } else {
                const inserted: any[] =
                  await tx`INSERT INTO "customers" ("phone","name") VALUES (${input.customer.phone}, ${input.customer.name}) RETURNING "id"`;
                customerId = Number(inserted[0].id);
              }
            }
            const orderRows: any[] = await tx`
            INSERT INTO "orders" ("orderNumber","customerId","outletId","shiftId","type","status","subtotal","total","paymentStatus","notes")
            VALUES (${input.orderNumber}, ${customerId}, ${outletId}, ${activeShift?.id ?? null}, ${input.type}, ${status}, ${subtotal}, ${subtotal}, 'unpaid', ${input.notes})
            RETURNING "id"`;
            const newId = Number(orderRows[0].id);
            for (const item of input.items) {
              await tx`
              INSERT INTO "order_items" ("orderId","menuItemId","variantId","itemName","quantity","selectedModifiers","lineTotal")
              VALUES (${newId}, ${item.menuItemId}, ${item.variantId ?? null}, ${item.itemName}, ${item.quantity}, ${item.selectedModifiers ? tx.json(item.selectedModifiers) : null}, ${item.lineTotal})`;
            }
            return newId;
          });
        } catch (e: any) {
          if (
            e?.code === "23505" ||
            /duplicate|unique/i.test(String(e?.message ?? ""))
          ) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "That ticket number is already in use.",
            });
          }
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "The ticket could not be saved. Please try again.",
            cause: { expose: true },
          });
        }

        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "order",
          entityId: id,
          outletId,
          action: "created",
          after: {
            orderNumber: input.orderNumber,
            type: input.type,
            status,
            total: subtotal,
            outletId,
          },
        });
        await supabase.from("notifications").insert({
          type: "order",
          title: `New ticket #${input.orderNumber}`,
          message:
            status === "preparing"
              ? "Auto-accept sent this ticket directly to the kitchen."
              : "This ticket is waiting in the new-order queue.",
          href: `/orders/${id}`,
        } as any);
        return { id, status };
      }),
    byId: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        await requirePermission(ctx.user, "orders.read");
        const record = await orderDetail(input.id);
        if (!record)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "The requested order no longer exists.",
          });
        await assertOutletAccess(ctx.user, (record as any).outletId ?? null);
        return record;
      }),
    updateStatus: protectedProcedure
      .input(
        z.object({ id: z.number().int().positive(), status: orderStatusSchema })
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx.user, "orders.update");
        const supabase = getSupabaseAdmin();
        const before = await orderDetail(input.id);
        if (!before)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "The requested order no longer exists.",
          });
        await assertOutletAccess(ctx.user, (before as any).outletId ?? null);
        if (before.status === "cancelled" || before.status === "completed")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Closed orders cannot be advanced.",
          });
        const { error } = await supabase
          .from("orders")
          .update({ status: input.status } as any)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "order",
          entityId: input.id,
          action: "status_updated",
          before: { status: before.status },
          after: { status: input.status },
        });
        if (input.status === "ready")
          await supabase.from("notifications").insert({
            type: "order",
            title: `Ticket #${before.orderNumber} is ready`,
            message:
              "The order is ready for its counter, table, or delivery handoff.",
            href: `/orders/${input.id}`,
          } as any);
        return orderDetail(input.id);
      }),
    cancel: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          reason: z.string().trim().min(3).max(240),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx.user, "orders.cancel");
        const supabase = getSupabaseAdmin();
        const before = await orderDetail(input.id);
        if (!before)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "The requested order no longer exists.",
          });
        await assertOutletAccess(ctx.user, (before as any).outletId ?? null);
        if (["completed", "cancelled"].includes(before.status))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only open orders may be cancelled.",
          });
        const newNotes = `${before.notes ? `${before.notes}\n` : ""}Cancellation: ${input.reason}`;
        const { error } = await supabase
          .from("orders")
          .update({ status: "cancelled", notes: newNotes } as any)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "order",
          entityId: input.id,
          action: "cancelled",
          before: { status: before.status },
          after: { status: "cancelled", reason: input.reason },
        });
        return { success: true };
      }),
  }),

  menu: router({
    list: protectedProcedure
      .input(
        paginationSchema.extend({
          categoryId: z.number().int().positive().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        await requirePermission(ctx.user, "menu");
        const supabase = getSupabaseAdmin();
        const limitPlusOne = input.limit + 1;
        // Fetch categories
        const { data: categoriesRaw } = await supabase
          .from("menu_categories")
          .select("*")
          .order("sortOrder", { ascending: true })
          .order("name", { ascending: true });
        const categories = (categoriesRaw ?? []) as any[];
        const catMap = new Map<number, string>(
          categories.map((c: any) => [c.id, c.name])
        );
        // Build menu items query with cursor, category, search
        let itemQuery = supabase
          .from("menu_items")
          .select("*")
          .order("id", { ascending: false })
          .limit(limitPlusOne);
        if (input.cursor) itemQuery = itemQuery.lt("id", input.cursor);
        if (input.categoryId)
          itemQuery = itemQuery.eq("categoryId", input.categoryId);
        if (input.search)
          itemQuery = itemQuery.ilike("name", `%${input.search}%`);
        const { data: rowsRaw, error } = await itemQuery;
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        const rows = (rowsRaw ?? []) as any[];
        const pageRows = rows.slice(0, input.limit);
        const itemIds = pageRows.map((r: any) => r.id);
        const variantMap = new Map<number, any[]>();
        if (itemIds.length) {
          const { data: variantsRaw } = await supabase
            .from("menu_item_variants")
            .select("*")
            .in("menuItemId", itemIds);
          const variants = (variantsRaw ?? []) as any[];
          for (const v of variants) {
            const arr = variantMap.get(v.menuItemId) ?? [];
            arr.push({
              ...v,
              price: decimal(v.price),
              quantity: v.quantity != null ? decimal(v.quantity) : null,
            });
            variantMap.set(v.menuItemId, arr);
          }
          for (const [, arr] of Array.from(variantMap.entries())) {
            arr.sort((a: any, b: any) => a.sortOrder - b.sortOrder);
          }
        }
        const page = pageRows.map((row: any) => ({
          ...row,
          categoryName: catMap.get(row.categoryId) ?? "",
          variants: variantMap.get(row.id) ?? [],
        }));
        return {
          categories,
          items: page,
          nextCursor: rows.length > input.limit ? page.at(-1)?.id : undefined,
        };
      }),
    createCategory: protectedProcedure
      .input(
        z.object({
          name: z.string().trim().min(2).max(100),
          description: z.string().trim().max(500).nullable().optional(),
          imageUrl: imageUrlSchema,
          comingSoon: z.boolean().optional().default(false),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx.user, "menu.create");
        const supabase = getSupabaseAdmin();
        let maxSort = 0;
        try {
          const sql = await getSql();
          const res: any[] = await sql.unsafe(
            `SELECT coalesce(max("sortOrder"), 0)::int as value FROM "menu_categories"`
          );
          maxSort = Number(res[0]?.value ?? 0);
        } catch {
          const { data: cats } = await supabase
            .from("menu_categories")
            .select("sortOrder");
          maxSort = Math.max(
            0,
            ...((cats ?? []) as any[]).map((c: any) => Number(c.sortOrder ?? 0))
          );
        }
        const { data: inserted, error } = await supabase
          .from("menu_categories")
          .insert({
            name: input.name,
            description: input.description?.trim() || null,
            imageUrl: input.imageUrl?.trim() || null,
            comingSoon: Boolean(input.comingSoon),
            sortOrder: maxSort + 1,
          } as any)
          .select("id")
          .single();
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        const id = Number((inserted as any).id);
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "menu_category",
          entityId: id,
          action: "created",
          after: {
            name: input.name,
            description: input.description ?? null,
            imageUrl: input.imageUrl ?? null,
            comingSoon: Boolean(input.comingSoon),
          },
        });
        return { id };
      }),
    updateCategory: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          name: z.string().trim().min(2).max(100),
          description: z.string().trim().max(500).nullable().optional(),
          imageUrl: imageUrlSchema,
          comingSoon: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx.user, "menu.update");
        const supabase = getSupabaseAdmin();
        const { data: currentRaw } = await supabase
          .from("menu_categories")
          .select("*")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        const current = currentRaw as any;
        if (!current)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Menu category not found.",
          });
        const patch: any = { name: input.name };
        if (input.description !== undefined)
          patch.description = input.description?.trim() || null;
        if (input.imageUrl !== undefined)
          patch.imageUrl = input.imageUrl?.trim() || null;
        if (input.comingSoon !== undefined)
          patch.comingSoon = Boolean(input.comingSoon);
        const { error } = await supabase
          .from("menu_categories")
          .update(patch as any)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "menu_category",
          entityId: input.id,
          action: "updated",
          before: {
            name: current.name,
            description: current.description ?? null,
            imageUrl: current.imageUrl ?? null,
            comingSoon: Boolean(current.comingSoon),
          },
          after: {
            name: input.name,
            ...(input.description !== undefined
              ? { description: patch.description }
              : {}),
            ...(input.imageUrl !== undefined
              ? { imageUrl: patch.imageUrl }
              : {}),
            ...(input.comingSoon !== undefined
              ? { comingSoon: patch.comingSoon }
              : {}),
          },
        });
        return { success: true };
      }),
    setCategoryComingSoon: protectedProcedure
      .input(
        z.object({ id: z.number().int().positive(), comingSoon: z.boolean() })
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx.user, "menu.update");
        const supabase = getSupabaseAdmin();
        const { data: currentRaw } = await supabase
          .from("menu_categories")
          .select("*")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        const current = currentRaw as any;
        if (!current)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Menu category not found.",
          });
        const { error } = await supabase
          .from("menu_categories")
          .update({ comingSoon: input.comingSoon } as any)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "menu_category",
          entityId: input.id,
          action: "coming_soon_updated",
          before: { comingSoon: Boolean(current.comingSoon) },
          after: { comingSoon: input.comingSoon },
        });
        return { success: true };
      }),
    removeCategory: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requireOwner(ctx.user);
        const supabase = getSupabaseAdmin();
        const { count } = await supabase
          .from("menu_items")
          .select("id", { count: "exact", head: true })
          .eq("categoryId", input.id);
        if (Number(count ?? 0) > 0)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Move or delete the category's menu items before deleting it.",
          });
        const { data: currentRaw } = await supabase
          .from("menu_categories")
          .select("*")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        const current = currentRaw as any;
        if (!current)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Menu category not found.",
          });
        const { error } = await supabase
          .from("menu_categories")
          .delete()
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "menu_category",
          entityId: input.id,
          action: "deleted",
          before: { name: current.name },
        });
        return { success: true };
      }),
    create: protectedProcedure
      .input(
        z.object({
          categoryId: z.number().int().positive(),
          name: z.string().trim().min(2).max(160),
          description: z.string().trim().max(1000).nullable(),
          imageUrl: imageUrlSchema,
          veg: z.boolean(),
          available: z.boolean(),
          comingSoon: z.boolean().optional().default(false),
          variants: variantsArraySchema,
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx.user, "menu.create");
        const supabase = getSupabaseAdmin();
        const variants = input.variants;
        validateVariantsPayload([...variants]);
        await checkSkuUniqueness(supabase, variants);
        const { data: inserted, error } = await supabase
          .from("menu_items")
          .insert({
            categoryId: input.categoryId,
            name: input.name.trim(),
            description: input.description,
            imageUrl: input.imageUrl,
            veg: input.veg,
            available: input.available,
            comingSoon: Boolean(input.comingSoon),
          } as any)
          .select("id")
          .single();
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        const id = Number((inserted as any).id);
        const payload = validateVariantsPayload([...variants]);
        for (let i = 0; i < payload.length; i++) {
          const v = payload[i];
          const { error: vErr } = await supabase
            .from("menu_item_variants")
            .insert({
              menuItemId: id,
              name: v.name.trim(),
              quantity: v.quantity ?? null,
              unit: normalizeUnit(v.unit),
              price: v.price,
              sku: v.sku?.trim() || null,
              available: v.available,
              isDefault: v.isDefault,
              sortOrder: i,
            } as any);
          if (vErr)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: vErr.message,
            });
        }
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "menu_item",
          entityId: id,
          action: "created",
          after: {
            categoryId: input.categoryId,
            name: input.name,
            variants: variants.length,
            comingSoon: Boolean(input.comingSoon),
          },
        });
        return { id };
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          categoryId: z.number().int().positive(),
          name: z.string().trim().min(2).max(160),
          description: z.string().trim().max(1000).nullable(),
          imageUrl: imageUrlSchema,
          veg: z.boolean(),
          available: z.boolean(),
          comingSoon: z.boolean().optional().default(false),
          variants: variantsArraySchema,
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx.user, "menu.update");
        const supabase = getSupabaseAdmin();
        const { data: currentRaw } = await supabase
          .from("menu_items")
          .select("*")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        const current = currentRaw as any;
        if (!current)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Menu item not found.",
          });
        const { error } = await supabase
          .from("menu_items")
          .update({
            categoryId: input.categoryId,
            name: input.name.trim(),
            description: input.description,
            imageUrl: input.imageUrl,
            veg: input.veg,
            available: input.available,
            comingSoon: Boolean(input.comingSoon),
          } as any)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        const { data: existingRaw } = await supabase
          .from("menu_item_variants")
          .select("id")
          .eq("menuItemId", input.id);
        const existingIds = new Set(
          ((existingRaw ?? []) as any[]).map((r: any) => r.id)
        );
        const payload = validateVariantsPayload([...input.variants]);
        const skuToCheck = payload.filter(v => v.sku);
        if (skuToCheck.length) {
          try {
            const sql = await getSql();
            const skus = skuToCheck.map(s => s.sku!.trim());
            const rows: any[] = await sql.unsafe(
              `SELECT "sku","id" FROM "menu_item_variants" WHERE lower("sku") IN (${skus.map((_, i) => `lower($${i + 1})`).join(",")})`,
              skus
            );
            for (const row of rows) {
              if (existingIds.has(row.id)) continue;
              if (
                skuToCheck.some(
                  v =>
                    v.sku?.trim().toLowerCase() ===
                    String(row.sku).toLowerCase()
                )
              )
                throw new TRPCError({
                  code: "CONFLICT",
                  message: `SKU "${row.sku}" already in use`,
                });
            }
          } catch (e) {
            if (e instanceof TRPCError) throw e;
            const { data: otherSkusRaw } = await supabase
              .from("menu_item_variants")
              .select("sku,id")
              .in(
                "sku",
                skuToCheck.map(s => s.sku!.trim())
              );
            for (const row of (otherSkusRaw ?? []) as any[]) {
              if (existingIds.has(row.id)) continue;
              if (
                skuToCheck.some(
                  v =>
                    v.sku?.trim().toLowerCase() ===
                    String(row.sku).toLowerCase()
                )
              )
                throw new TRPCError({
                  code: "CONFLICT",
                  message: `SKU "${row.sku}" already in use`,
                });
            }
          }
        }
        await syncVariantsForItem(supabase, input.id, payload);
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "menu_item",
          entityId: input.id,
          action: "updated",
          before: {
            name: current.name,
            available: current.available,
            comingSoon: Boolean(current.comingSoon),
          },
          after: {
            name: input.name.trim(),
            variants: input.variants.length,
            comingSoon: Boolean(input.comingSoon),
          },
        });
        return { success: true };
      }),
    setComingSoon: protectedProcedure
      .input(
        z.object({ id: z.number().int().positive(), comingSoon: z.boolean() })
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx.user, "menu.update");
        const supabase = getSupabaseAdmin();
        const { data: currentRaw } = await supabase
          .from("menu_items")
          .select("*")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        const current = currentRaw as any;
        if (!current)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Menu item not found.",
          });
        const { error } = await supabase
          .from("menu_items")
          .update({ comingSoon: input.comingSoon } as any)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "menu_item",
          entityId: input.id,
          action: "coming_soon_updated",
          before: { comingSoon: Boolean(current.comingSoon) },
          after: { comingSoon: input.comingSoon },
        });
        return { success: true };
      }),
    setAvailability: protectedProcedure
      .input(
        z.object({ id: z.number().int().positive(), available: z.boolean() })
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx.user, "menu.update");
        const supabase = getSupabaseAdmin();
        const { data: currentRaw } = await supabase
          .from("menu_items")
          .select("*")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        const current = currentRaw as any;
        if (!current)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Menu item not found.",
          });
        const { error } = await supabase
          .from("menu_items")
          .update({ available: input.available } as any)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "menu_item",
          entityId: input.id,
          action: "availability_updated",
          before: { available: current.available },
          after: { available: input.available },
        });
        return { success: true };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requireOwner(ctx.user);
        const supabase = getSupabaseAdmin();
        const { data: currentRaw } = await supabase
          .from("menu_items")
          .select("*")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        const current = currentRaw as any;
        if (!current)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Menu item not found.",
          });
        const { error } = await supabase
          .from("menu_items")
          .delete()
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "menu_item",
          entityId: input.id,
          action: "deleted",
          before: { name: current.name },
        });
        return { success: true };
      }),
    variants: router({
      byItem: protectedProcedure
        .input(z.object({ menuItemId: z.number().int().positive() }))
        .query(async ({ ctx, input }) => {
          await requirePermission(ctx.user, "menu");
          const supabase = getSupabaseAdmin();
          const { data: rowsRaw, error } = await supabase
            .from("menu_item_variants")
            .select("*")
            .eq("menuItemId", input.menuItemId)
            .order("sortOrder", { ascending: true });
          if (error)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
            });
          return ((rowsRaw ?? []) as any[]).map(r => ({
            ...r,
            price: decimal(r.price),
            quantity: r.quantity != null ? decimal(r.quantity) : null,
          }));
        }),
      setAvailability: protectedProcedure
        .input(
          z.object({ id: z.number().int().positive(), available: z.boolean() })
        )
        .mutation(async ({ ctx, input }) => {
          await requirePermission(ctx.user, "menu.update");
          const supabase = getSupabaseAdmin();
          const { data: curRaw } = await supabase
            .from("menu_item_variants")
            .select("*")
            .eq("id", input.id)
            .limit(1)
            .maybeSingle();
          const cur = curRaw as any;
          if (!cur)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Variant not found.",
            });
          const { error } = await supabase
            .from("menu_item_variants")
            .update({ available: input.available } as any)
            .eq("id", input.id);
          if (error)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
            });
          await recordAudit({
            actorUserId: ctx.user.id,
            entityType: "menu_item_variant",
            entityId: input.id,
            action: "availability_updated",
            before: { available: cur.available },
            after: { available: input.available },
          });
          return { success: true };
        }),
      setDefault: protectedProcedure
        .input(z.object({ id: z.number().int().positive() }))
        .mutation(async ({ ctx, input }) => {
          await requirePermission(ctx.user, "menu.update");
          const supabase = getSupabaseAdmin();
          const { data: curRaw } = await supabase
            .from("menu_item_variants")
            .select("*")
            .eq("id", input.id)
            .limit(1)
            .maybeSingle();
          const cur = curRaw as any;
          if (!cur)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Variant not found.",
            });
          const itemId = cur.menuItemId;
          const { data: siblingsRaw } = await supabase
            .from("menu_item_variants")
            .select("*")
            .eq("menuItemId", itemId);
          const siblings = (siblingsRaw ?? []) as any[];
          for (const s of siblings) {
            const { error } = await supabase
              .from("menu_item_variants")
              .update({ isDefault: s.id === input.id } as any)
              .eq("id", s.id);
            if (error)
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message,
              });
          }
          await recordAudit({
            actorUserId: ctx.user.id,
            entityType: "menu_item_variant",
            entityId: input.id,
            action: "default_updated",
            after: { menuItemId: itemId },
          });
          return { success: true };
        }),
      outletAvailability: router({
        set: protectedProcedure
          .input(
            z.object({
              outletId: z.number().int().positive(),
              variantId: z.number().int().positive(),
              available: z.boolean(),
              priceOverride: z
                .number()
                .positive()
                .max(1_000_000)
                .nullable()
                .optional(),
            })
          )
          .mutation(async ({ ctx, input }) => {
            await requirePermission(ctx.user, "menu.update");
            await assertOutletAccess(ctx.user, input.outletId);
            const supabase = getSupabaseAdmin();
            const { data: vRaw } = await supabase
              .from("menu_item_variants")
              .select("id")
              .eq("id", input.variantId)
              .limit(1)
              .maybeSingle();
            if (!(vRaw as any)?.id)
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Variant not found.",
              });
            const { data: existingRaw } = await supabase
              .from("outlet_variant_availability")
              .select("*")
              .eq("outletId", input.outletId)
              .eq("variantId", input.variantId)
              .limit(1)
              .maybeSingle();
            const existing = existingRaw as any;
            if (existing?.id) {
              const { error } = await supabase
                .from("outlet_variant_availability")
                .update({
                  available: input.available,
                  priceOverride:
                    input.priceOverride != null ? input.priceOverride : null,
                } as any)
                .eq("id", existing.id);
              if (error)
                throw new TRPCError({
                  code: "INTERNAL_SERVER_ERROR",
                  message: error.message,
                });
            } else {
              const { error } = await supabase
                .from("outlet_variant_availability")
                .insert({
                  outletId: input.outletId,
                  variantId: input.variantId,
                  available: input.available,
                  priceOverride:
                    input.priceOverride != null ? input.priceOverride : null,
                } as any);
              if (error)
                throw new TRPCError({
                  code: "INTERNAL_SERVER_ERROR",
                  message: error.message,
                });
            }
            await recordAudit({
              actorUserId: ctx.user.id,
              entityType: "outlet_variant_availability",
              entityId: input.variantId,
              outletId: input.outletId,
              action: "variant_availability_updated",
              after: {
                available: input.available,
                priceOverride: input.priceOverride,
              },
            });
            return { success: true };
          }),
        byOutlet: protectedProcedure
          .input(z.object({ outletId: z.number().int().positive() }))
          .query(async ({ ctx, input }) => {
            await requirePermission(ctx.user, "menu.read");
            await assertOutletAccess(ctx.user, input.outletId);
            const supabase = getSupabaseAdmin();
            const { data: rowsRaw, error } = await supabase
              .from("outlet_variant_availability")
              .select("*")
              .eq("outletId", input.outletId);
            if (error)
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message,
              });
            return ((rowsRaw ?? []) as any[]).map(r => ({
              ...r,
              priceOverride:
                r.priceOverride != null ? decimal(r.priceOverride) : null,
            }));
          }),
      }),
    }),
    modifiers: router({
      list: protectedProcedure.query(async ({ ctx }) => {
        await requirePermission(ctx.user, "menu");
        const supabase = getSupabaseAdmin();
        const [
          { data: groupsRaw, error: gErr },
          { data: optionsRaw, error: oErr },
        ] = await Promise.all([
          supabase
            .from("modifier_groups")
            .select("*")
            .order("name", { ascending: true }),
          supabase
            .from("modifier_options")
            .select("*")
            .order("name", { ascending: true }),
        ]);
        if (gErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: gErr.message,
          });
        if (oErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: oErr.message,
          });
        const groups = (groupsRaw ?? []) as any[];
        const options = (optionsRaw ?? []) as any[];
        return groups.map(group => ({
          ...group,
          options: options
            .filter(option => option.groupId === group.id)
            .map(option => ({
              ...option,
              priceDelta: decimal(option.priceDelta),
            })),
        }));
      }),
      forItem: protectedProcedure
        .input(z.object({ menuItemId: z.number().int().positive() }))
        .query(async ({ ctx, input }) => {
          await requirePermission(ctx.user, "menu");
          const supabase = getSupabaseAdmin();
          const { data: assignmentsRaw, error } = await supabase
            .from("menu_item_modifiers")
            .select("modifierGroupId")
            .eq("menuItemId", input.menuItemId);
          if (error)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
            });
          return ((assignmentsRaw ?? []) as any[]).map(
            assignment => assignment.modifierGroupId
          );
        }),
      createGroup: protectedProcedure
        .input(
          z.object({
            name: z.string().trim().min(2).max(120),
            type: z.enum(["single", "multiple"]),
            required: z.boolean(),
          })
        )
        .mutation(async ({ ctx, input }) => {
          await requirePermission(ctx.user, "menu.create");
          const supabase = getSupabaseAdmin();
          const { data: inserted, error } = await supabase
            .from("modifier_groups")
            .insert(input as any)
            .select("id")
            .single();
          if (error)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
            });
          const id = Number((inserted as any).id);
          await recordAudit({
            actorUserId: ctx.user.id,
            entityType: "modifier_group",
            entityId: id,
            action: "created",
            after: input,
          });
          return { id };
        }),
      updateGroup: protectedProcedure
        .input(
          z.object({
            id: z.number().int().positive(),
            name: z.string().trim().min(2).max(120),
            type: z.enum(["single", "multiple"]),
            required: z.boolean(),
          })
        )
        .mutation(async ({ ctx, input }) => {
          await requirePermission(ctx.user, "menu.update");
          const supabase = getSupabaseAdmin();
          const { data: currentRaw } = await supabase
            .from("modifier_groups")
            .select("*")
            .eq("id", input.id)
            .limit(1)
            .maybeSingle();
          const current = currentRaw as any;
          if (!current)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Modifier group not found.",
            });
          const { error } = await supabase
            .from("modifier_groups")
            .update({
              name: input.name,
              type: input.type,
              required: input.required,
            } as any)
            .eq("id", input.id);
          if (error)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
            });
          await recordAudit({
            actorUserId: ctx.user.id,
            entityType: "modifier_group",
            entityId: input.id,
            action: "updated",
            before: current as unknown as Record<string, unknown>,
            after: input,
          });
          return { success: true };
        }),
      removeGroup: protectedProcedure
        .input(z.object({ id: z.number().int().positive() }))
        .mutation(async ({ ctx, input }) => {
          await requireOwner(ctx.user);
          const supabase = getSupabaseAdmin();
          const { data: currentRaw } = await supabase
            .from("modifier_groups")
            .select("*")
            .eq("id", input.id)
            .limit(1)
            .maybeSingle();
          const current = currentRaw as any;
          if (!current)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Modifier group not found.",
            });
          const { error } = await supabase
            .from("modifier_groups")
            .delete()
            .eq("id", input.id);
          if (error)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
            });
          await recordAudit({
            actorUserId: ctx.user.id,
            entityType: "modifier_group",
            entityId: input.id,
            action: "deleted",
            before: { name: current.name },
          });
          return { success: true };
        }),
      addOption: protectedProcedure
        .input(
          z.object({
            groupId: z.number().int().positive(),
            name: z.string().trim().min(1).max(120),
            priceDelta: z.number().min(-1_000_000).max(1_000_000),
          })
        )
        .mutation(async ({ ctx, input }) => {
          await requirePermission(ctx.user, "menu.create");
          const supabase = getSupabaseAdmin();
          const { data: inserted, error } = await supabase
            .from("modifier_options")
            .insert({
              groupId: input.groupId,
              name: input.name,
              priceDelta: input.priceDelta,
            } as any)
            .select("id")
            .single();
          if (error)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
            });
          const id = Number((inserted as any).id);
          await recordAudit({
            actorUserId: ctx.user.id,
            entityType: "modifier_option",
            entityId: id,
            action: "created",
            after: input,
          });
          return { id };
        }),
      updateOption: protectedProcedure
        .input(
          z.object({
            id: z.number().int().positive(),
            name: z.string().trim().min(1).max(120),
            priceDelta: z.number().min(-1_000_000).max(1_000_000),
          })
        )
        .mutation(async ({ ctx, input }) => {
          await requirePermission(ctx.user, "menu.update");
          const supabase = getSupabaseAdmin();
          const { data: currentRaw } = await supabase
            .from("modifier_options")
            .select("*")
            .eq("id", input.id)
            .limit(1)
            .maybeSingle();
          const current = currentRaw as any;
          if (!current)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Modifier option not found.",
            });
          const { error } = await supabase
            .from("modifier_options")
            .update({ name: input.name, priceDelta: input.priceDelta } as any)
            .eq("id", input.id);
          if (error)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
            });
          await recordAudit({
            actorUserId: ctx.user.id,
            entityType: "modifier_option",
            entityId: input.id,
            action: "updated",
            before: { name: current.name, priceDelta: current.priceDelta },
            after: input,
          });
          return { success: true };
        }),
      removeOption: protectedProcedure
        .input(z.object({ id: z.number().int().positive() }))
        .mutation(async ({ ctx, input }) => {
          await requirePermission(ctx.user, "menu");
          const supabase = getSupabaseAdmin();
          const { data: currentRaw } = await supabase
            .from("modifier_options")
            .select("*")
            .eq("id", input.id)
            .limit(1)
            .maybeSingle();
          const current = currentRaw as any;
          if (!current)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Modifier option not found.",
            });
          const { error } = await supabase
            .from("modifier_options")
            .delete()
            .eq("id", input.id);
          if (error)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
            });
          await recordAudit({
            actorUserId: ctx.user.id,
            entityType: "modifier_option",
            entityId: input.id,
            action: "deleted",
            before: { name: current.name },
          });
          return { success: true };
        }),
      setItemGroups: protectedProcedure
        .input(
          z.object({
            menuItemId: z.number().int().positive(),
            groupIds: z.array(z.number().int().positive()).max(30),
          })
        )
        .mutation(async ({ ctx, input }) => {
          await requirePermission(ctx.user, "menu.update");
          const supabase = getSupabaseAdmin();
          const { data: itemRaw } = await supabase
            .from("menu_items")
            .select("id")
            .eq("id", input.menuItemId)
            .limit(1)
            .maybeSingle();
          if (!(itemRaw as any)?.id)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Menu item not found.",
            });
          if (input.groupIds.length) {
            let groupsCount = 0;
            try {
              const sql = await getSql();
              const rows: any[] = await sql.unsafe(
                `SELECT "id" FROM "modifier_groups" WHERE "id" IN (${input.groupIds.map((_, i) => `$${i + 1}`).join(",")})`,
                input.groupIds
              );
              groupsCount = rows.length;
            } catch {
              const { data: groupsRaw } = await supabase
                .from("modifier_groups")
                .select("id")
                .in("id", input.groupIds);
              groupsCount = (groupsRaw ?? []).length;
            }
            if (groupsCount !== input.groupIds.length)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "One or more modifier groups no longer exist.",
              });
          }
          const { error: delErr } = await supabase
            .from("menu_item_modifiers")
            .delete()
            .eq("menuItemId", input.menuItemId);
          if (delErr)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: delErr.message,
            });
          if (input.groupIds.length) {
            const payload = input.groupIds.map(
              modifierGroupId =>
                ({ menuItemId: input.menuItemId, modifierGroupId }) as any
            );
            const { error: insErr } = await supabase
              .from("menu_item_modifiers")
              .insert(payload as any);
            if (insErr)
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: insErr.message,
              });
          }
          await recordAudit({
            actorUserId: ctx.user.id,
            entityType: "menu_item",
            entityId: input.menuItemId,
            action: "modifier_groups_updated",
            after: { groupIds: input.groupIds },
          });
          return { success: true };
        }),
    }),
  }),

  storage: router({
    uploadProductImage: protectedProcedure
      .input(
        z.object({
          filename: z.string().trim().min(1).max(120),
          contentType: z.string().trim().min(3).max(80),
          data: z.string().min(1).max(10_000_000),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx.user, "menu.update");
        const allowedTypes = new Set([
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/gif",
          "image/avif",
          "image/jpg",
        ]);
        const ct = input.contentType.toLowerCase();
        if (!allowedTypes.has(ct))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only JPEG, PNG, WebP, GIF, AVIF images are allowed",
          });
        let b64 = input.data;
        const commaIdx = b64.indexOf(",");
        if (b64.startsWith("data:")) {
          if (commaIdx !== -1) b64 = b64.slice(commaIdx + 1);
        }
        let buffer: Buffer;
        try {
          buffer = Buffer.from(b64, "base64");
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid image data",
          });
        }
        const maxBytes = 5 * 1024 * 1024;
        if (buffer.length === 0)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Empty image" });
        if (buffer.length > maxBytes)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Image too large — max 5 MB (got ${(buffer.length / 1024 / 1024).toFixed(2)} MB)`,
          });
        assertImageBytes(buffer, ct);
        const safeName =
          input.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) ||
          "image";
        const ext = safeName.includes(".")
          ? safeName.split(".").pop()!.toLowerCase()
          : ct.split("/")[1] || "jpg";
        const base = safeName.replace(/\.[^.]+$/, "") || "product";
        const key = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base}.${ext}`;
        const supabase = getSupabaseAdmin();
        const bucket = "product-images";
        const { error } = await supabase.storage
          .from(bucket)
          .upload(key, buffer as any, {
            contentType: ct,
            upsert: false,
            cacheControl: "3600",
          });
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Upload failed: ${error.message}`,
          });
        // Build public URL deterministically (getPublicUrl can return empty if client URL is unset)
        const baseUrl = (
          ENV.supabaseUrl ||
          process.env.SUPABASE_URL ||
          (process.env.SUPABASE_PROJECT_REF &&
            `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co`) ||
          ""
        ).replace(/\/+$/, "");
        if (!baseUrl)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "SUPABASE_URL not configured",
          });
        const url = `${baseUrl}/storage/v1/object/public/${bucket}/${key}`;
        try {
          await recordAudit({
            actorUserId: ctx.user.id,
            entityType: "product_image",
            entityId: 0,
            action: "uploaded",
            after: { key, bucket, contentType: ct, bytes: buffer.length },
          });
        } catch {}
        return { key, url, bytes: buffer.length };
      }),

    uploadCategoryImage: protectedProcedure
      .input(
        z.object({
          filename: z.string().trim().min(1).max(120),
          contentType: z.string().trim().min(3).max(80),
          data: z.string().min(1).max(10_000_000),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx.user, "menu.update");
        const allowedTypes = new Set([
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/gif",
          "image/avif",
          "image/jpg",
        ]);
        const ct = input.contentType.toLowerCase();
        if (!allowedTypes.has(ct))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only JPEG, PNG, WebP, GIF, AVIF images are allowed",
          });
        let b64 = input.data;
        const commaIdx = b64.indexOf(",");
        if (b64.startsWith("data:")) {
          if (commaIdx !== -1) b64 = b64.slice(commaIdx + 1);
        }
        let buffer: Buffer;
        try {
          buffer = Buffer.from(b64, "base64");
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid image data",
          });
        }
        const maxBytes = 5 * 1024 * 1024;
        if (buffer.length === 0)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Empty image" });
        if (buffer.length > maxBytes)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Image too large — max 5 MB (got ${(buffer.length / 1024 / 1024).toFixed(2)} MB)`,
          });
        assertImageBytes(buffer, ct);
        const safeName =
          input.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) ||
          "image";
        const ext = safeName.includes(".")
          ? safeName.split(".").pop()!.toLowerCase()
          : ct.split("/")[1] || "jpg";
        const base = safeName.replace(/\.[^.]+$/, "") || "category";
        const key = `categories/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base}.${ext}`;
        const supabase = getSupabaseAdmin();
        const bucket = "category-images";
        const { error } = await supabase.storage
          .from(bucket)
          .upload(key, buffer as any, {
            contentType: ct,
            upsert: false,
            cacheControl: "3600",
          });
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Upload failed: ${error.message}`,
          });
        const baseUrl = (
          ENV.supabaseUrl ||
          process.env.SUPABASE_URL ||
          (process.env.SUPABASE_PROJECT_REF &&
            `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co`) ||
          ""
        ).replace(/\/+$/, "");
        if (!baseUrl)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "SUPABASE_URL not configured",
          });
        const url = `${baseUrl}/storage/v1/object/public/${bucket}/${key}`;
        try {
          await recordAudit({
            actorUserId: ctx.user.id,
            entityType: "category_image",
            entityId: 0,
            action: "uploaded",
            after: { key, bucket, contentType: ct, bytes: buffer.length },
          });
        } catch {}
        return { key, url, bytes: buffer.length };
      }),
  }),
});

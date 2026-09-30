import { getSql, getSupabaseAdmin } from "../db/supabase";
import { ENV } from "../config/env";
import { recordAudit } from "../db";
import { getAbsoluteLifetimeSec, hashToken } from "./auth";

// ── Device sessions ─────────────────────────────────────────────────────────
// One row per signed-in device. This table used to be write-only bookkeeping:
// login stored the hash of a random token that was never given to the client,
// so nothing was ever validated against it, nothing could be revoked
// individually, and rows were never pruned. It is now the authoritative
// per-device session store:
//
//   token_hash  SHA-256 of the opaque refresh token. The token itself is only
//               ever held in the device cookie and is never persisted.
//   family_id   Rotation family. Presenting an already-rotated token revokes
//               the entire family and forces a fresh login.
//   remember    true  → persistent device session (AUTH_REMEMBER_DAYS)
//               false → session cookie, bounded by AUTH_SESSION_HOURS
//   replaced_by Rotation chain, which is what makes reuse detectable.
//
// The access JWT carries the row id in a `sid` claim, so revoking one device
// takes effect without a global `users.sessionVersion` bump (which would sign
// the user out everywhere — the previous behaviour of `auth.logout`).

// PostgREST latency was measured at 5-50s in practice, against ~0.4s for the
// same statement over the direct pooler. Reads on this module sit on the hot
// path of EVERY authenticated request (session validation), so waiting out a
// slow PostgREST call before falling back would stall the whole panel. The
// window is therefore short: get to the pooler quickly.
const REST_TIMEOUT_MS = 1500;
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

export type SessionRecord = {
  id: number;
  userId: number;
  tokenHash: string;
  familyId: string;
  audience: "admin" | "pos";
  remember: boolean;
  deviceLabel: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  replacedBy: number | null;
  sessionVersionAtCreation: number;
};

/** Shape returned to the admin "Active devices" view. Never includes token material. */
export type SessionSummary = {
  id: number;
  deviceLabel: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  remember: boolean;
  isCurrent: boolean;
};

function toRecord(row: any): SessionRecord {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    tokenHash: String(row.token_hash),
    familyId: String(row.family_id),
    audience: row.audience as "admin" | "pos",
    remember: Boolean(row.remember),
    deviceLabel: row.device_label ?? null,
    userAgent: row.user_agent ?? null,
    ipAddress: row.ip_address ?? null,
    createdAt: new Date(row.created_at),
    lastUsedAt: new Date(row.last_used_at),
    expiresAt: new Date(row.expires_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    revokedReason: row.revoked_reason ?? null,
    replacedBy: row.replaced_by != null ? Number(row.replaced_by) : null,
    sessionVersionAtCreation: Number(row.session_version_at_creation ?? 0),
  };
}

/**
 * Run a Supabase REST query, falling back to direct SQL on timeout/error.
 *
 * Normalises the response to an array: PostgREST's `.single()` resolves to a
 * single object, not a list.
 */
async function query<T>(
  rest: () => PromiseLike<any>,
  sql: () => Promise<T[]>
): Promise<T[]> {
  try {
    const res: any = await withTimeout(
      rest(),
      REST_TIMEOUT_MS,
      "sessions query"
    );
    if (res?.error) throw res.error;
    const data = res?.data;
    if (data == null) return [];
    return (Array.isArray(data) ? data : [data]) as T[];
  } catch {
    return sql();
  }
}

// ── Device label ────────────────────────────────────────────────────────────
// Derived from the User-Agent so the sessions list is recognisable ("Chrome on
// macOS"). Falls back to a generic label rather than echoing raw UA text into
// the UI, and is length-capped to fit the column.
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").slice(0, 400);
  if (!ua) return "Unknown device";
  const os = /Windows NT/i.test(ua)
    ? "Windows"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iOS"
      : /Mac OS X|Macintosh/i.test(ua)
        ? "macOS"
        : /Android/i.test(ua)
          ? "Android"
          : /CrOS/i.test(ua)
            ? "ChromeOS"
            : /Linux/i.test(ua)
              ? "Linux"
              : "";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\//i.test(ua)
      ? "Opera"
      : /Firefox\//i.test(ua)
        ? "Firefox"
        : /Chrome\//i.test(ua)
          ? "Chrome"
          : /Safari\//i.test(ua)
            ? "Safari"
            : "";
  const parts = [browser, os].filter(Boolean);
  if (parts.length) return parts.join(" on ").slice(0, 160);
  return "Unknown device";
}

export type CreateSessionInput = {
  userId: number;
  audience: "admin" | "pos";
  /** Raw refresh token. Only `hashToken(token)` is persisted. */
  refreshToken: string;
  familyId: string;
  remember: boolean;
  userAgent?: string | null;
  ipAddress?: string | null;
  sessionVersion: number;
};

export async function createSession(
  input: CreateSessionInput
): Promise<SessionRecord> {
  const supabase = getSupabaseAdmin() as any;
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + getAbsoluteLifetimeSec(input.remember) * 1000
  );
  const deviceLabel = describeDevice(input.userAgent);
  const tokenHash = hashToken(input.refreshToken);
  const row = {
    user_id: input.userId,
    token_hash: tokenHash,
    family_id: input.familyId,
    audience: input.audience,
    remember: input.remember,
    device_label: deviceLabel,
    user_agent: (input.userAgent ?? "").slice(0, 512) || null,
    // `ip_address` is inet — only a real address (or NULL) is accepted.
    ip_address:
      input.ipAddress && input.ipAddress !== "unknown" ? input.ipAddress : null,
    created_at: now.toISOString(),
    last_used_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    session_version_at_creation: input.sessionVersion,
  };
  const rows = await query<any>(
    () => supabase.from("sessions").insert(row).select().single(),
    async () => {
      const sql = await getSql();
      return sql.unsafe(
        `INSERT INTO sessions (user_id, token_hash, family_id, audience, remember, device_label, user_agent, ip_address, created_at, last_used_at, expires_at, session_version_at_creation)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          row.user_id,
          row.token_hash,
          row.family_id,
          row.audience,
          row.remember,
          row.device_label,
          row.user_agent,
          row.ip_address,
          row.created_at,
          row.last_used_at,
          row.expires_at,
          row.session_version_at_creation,
        ]
      ) as any;
    }
  );
  if (!rows[0]) {
    // A REST timeout is ambiguous: the insert may have committed even though we
    // never saw the response, in which case the SQL fallback hits the UNIQUE
    // index on token_hash. Re-read rather than failing the login.
    const existing = await findSessionByTokenHash(tokenHash);
    if (existing) return existing;
    throw new Error("createSession returned no row");
  }
  return toRecord(rows[0]);
}

export async function findSessionByTokenHash(
  tokenHash: string
): Promise<SessionRecord | null> {
  const supabase = getSupabaseAdmin() as any;
  const rows = await query<any>(
    () =>
      supabase
        .from("sessions")
        .select("*")
        .eq("token_hash", tokenHash)
        .limit(1),
    async () => {
      const sql = await getSql();
      return sql.unsafe(
        "SELECT * FROM sessions WHERE token_hash = $1 LIMIT 1",
        [tokenHash]
      ) as any;
    }
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function findSessionById(
  id: number
): Promise<SessionRecord | null> {
  const supabase = getSupabaseAdmin() as any;
  const rows = await query<any>(
    () => supabase.from("sessions").select("*").eq("id", id).limit(1),
    async () => {
      const sql = await getSql();
      return sql.unsafe("SELECT * FROM sessions WHERE id = $1 LIMIT 1", [
        id,
      ]) as any;
    }
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

/** Active device sessions for a user, newest activity first. */
export async function listActiveSessions(
  userId: number,
  audience: "admin" | "pos" = "admin"
): Promise<SessionSummary[]> {
  const supabase = getSupabaseAdmin() as any;
  const rows = await query<any>(
    () =>
      supabase
        .from("sessions")
        .select(
          "id,device_label,user_agent,ip_address,created_at,last_used_at,expires_at,remember"
        )
        .eq("user_id", userId)
        .eq("audience", audience)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("last_used_at", { ascending: false }),
    async () => {
      const sql = await getSql();
      return sql.unsafe(
        `SELECT id,device_label,user_agent,ip_address,created_at,last_used_at,expires_at,remember
           FROM sessions
          WHERE user_id = $1 AND audience = $2 AND revoked_at IS NULL AND expires_at > now()
          ORDER BY last_used_at DESC`,
        [userId, audience]
      ) as any;
    }
  );
  return rows.map((r: any) => ({
    id: Number(r.id),
    deviceLabel: r.device_label ?? null,
    userAgent: r.user_agent ?? null,
    ipAddress: r.ip_address ?? null,
    createdAt: new Date(r.created_at),
    lastUsedAt: new Date(r.last_used_at),
    expiresAt: new Date(r.expires_at),
    remember: Boolean(r.remember),
    isCurrent: false,
  }));
}

/** Refresh `last_used_at` without blocking the request. */
export async function touchSession(id: number): Promise<void> {
  try {
    const supabase = getSupabaseAdmin() as any;
    await withTimeout(
      supabase
        .from("sessions")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", id),
      REST_TIMEOUT_MS,
      "sessions touch"
    );
  } catch {
    /* activity tracking is best effort */
  }
}

// ── Rotation ────────────────────────────────────────────────────────────────

export type RotateResult =
  | { status: "ok"; session: SessionRecord }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "revoked" }
  | { status: "reuse"; familyId: string; userId: number };

/**
 * Exchange a refresh token for a new one.
 *
 * Reuse detection: a rotated token stays in the table (marked revoked with
 * `replaced_by`) so that replaying it is detectable. Presenting one revokes the
 * whole `family_id` — every device descended from that login — because a replay
 * means the token was captured, and we cannot tell which side is the attacker.
 */
export async function rotateSession(
  tokenHash: string,
  next: { refreshToken: string }
): Promise<RotateResult> {
  const existing = await findSessionByTokenHash(tokenHash);
  if (!existing) return { status: "invalid" };

  if (existing.revokedAt) {
    // Already rotated or explicitly revoked. This is a replay.
    const familyId = existing.familyId;
    const userId = existing.userId;
    await revokeFamily(familyId, "refresh_token_reuse");
    try {
      await recordAudit({
        actorUserId: userId,
        entityType: "auth",
        action: "session_reuse_detected",
        after: { familyId, sessionId: existing.id },
      });
    } catch {}
    return { status: "reuse", familyId, userId };
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    await revokeSessionById(existing.id, existing.userId, "expired");
    return { status: "expired" };
  }

  // Mint the successor, then retire this row. The successor inherits the family
  // AND the session-version binding of the row it replaces — rotation must not
  // change which `users.sessionVersion` generation the session belongs to, or
  // the new token would fail its own revocation check on the next request.
  const created = await createSession({
    userId: existing.userId,
    audience: existing.audience,
    refreshToken: next.refreshToken,
    familyId: existing.familyId,
    remember: existing.remember,
    userAgent: existing.userAgent,
    ipAddress: existing.ipAddress,
    sessionVersion: existing.sessionVersionAtCreation,
  });
  await revokeSessionById(existing.id, existing.userId, "rotated", created.id);
  return { status: "ok", session: created };
}

/** Revoke every session sharing a family id. */
export async function revokeFamily(
  familyId: string,
  reason = "family_revoked"
): Promise<number> {
  const now = new Date().toISOString();
  const supabase = getSupabaseAdmin() as any;
  const { error } = await supabase
    .from("sessions")
    .update({ revoked_at: now, revoked_reason: reason })
    .eq("family_id", familyId)
    .is("revoked_at", null);
  if (error) {
    const sql = await getSql();
    await sql.unsafe(
      `UPDATE sessions SET revoked_at = $1, revoked_reason = $2 WHERE family_id = $3 AND revoked_at IS NULL`,
      [now, reason, familyId]
    );
  }
  return 0;
}

/**
 * Revoke one session, scoped to `userId` so a session id from another account
 * can never be targeted (the `user_id` predicate is the authorization check).
 */
export async function revokeSessionById(
  id: number,
  userId: number,
  reason = "revoked",
  replacedBy?: number | null
): Promise<boolean> {
  const now = new Date().toISOString();
  const supabase = getSupabaseAdmin() as any;
  const patch: any = { revoked_at: now, revoked_reason: reason };
  if (replacedBy != null) patch.replaced_by = replacedBy;
  const { data, error } = await supabase
    .from("sessions")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id");
  if (error) {
    const sql = await getSql();
    const rows = await sql.unsafe(
      `UPDATE sessions SET revoked_at = $1, revoked_reason = $2, replaced_by = $3
        WHERE id = $4 AND user_id = $5 AND revoked_at IS NULL RETURNING id`,
      [now, reason, replacedBy ?? null, id, userId]
    );
    return rows.length > 0;
  }
  return Array.isArray(data) && data.length > 0;
}

/** Revoke all of a user's sessions except the one identified by `exceptId`. */
export async function revokeOtherSessions(
  userId: number,
  exceptId: number | null,
  reason = "revoke_others",
  audience: "admin" | "pos" = "admin"
): Promise<number> {
  const now = new Date().toISOString();
  const supabase = getSupabaseAdmin() as any;
  let q = supabase
    .from("sessions")
    .update({ revoked_at: now, revoked_reason: reason })
    .eq("user_id", userId)
    .eq("audience", audience)
    .is("revoked_at", null);
  if (exceptId != null) q = q.neq("id", exceptId);
  const { data, error } = await q.select("id");
  if (error) {
    const sql = await getSql();
    const rows = await sql.unsafe(
      `UPDATE sessions SET revoked_at = $1, revoked_reason = $2
        WHERE user_id = $3 AND audience = $4 AND revoked_at IS NULL
          AND ($5::int IS NULL OR id <> $5::int)
        RETURNING id`,
      [now, reason, userId, audience, exceptId ?? null]
    );
    return rows.length;
  }
  return Array.isArray(data) ? data.length : 0;
}

/** Revoke every session for a user (password change, account disablement). */
export async function revokeAllSessionsForUser(
  userId: number,
  reason = "revoke_all"
): Promise<void> {
  const now = new Date().toISOString();
  const supabase = getSupabaseAdmin() as any;
  const { error } = await supabase
    .from("sessions")
    .update({ revoked_at: now, revoked_reason: reason })
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (error) {
    const sql = await getSql();
    await sql.unsafe(
      `UPDATE sessions SET revoked_at = $1, revoked_reason = $2 WHERE user_id = $3 AND revoked_at IS NULL`,
      [now, reason, userId]
    );
  }
  try {
    await recordAudit({
      actorUserId: userId,
      entityType: "auth",
      action: "sessions_revoked",
      after: { userId, reason },
    });
  } catch {}
}

// ── Validation ──────────────────────────────────────────────────────────────
// Short-lived cache so the per-request existence check does not become a
// per-request database round trip. A revoked session therefore stops being
// honoured within SESSION_STATE_CACHE_TTL_MS rather than instantly; logout
// still clears the cookie, so the window only matters for remote revocation.
const SESSION_STATE_CACHE_TTL_MS = 15_000;
const sessionStateCache = new Map<number, { ok: boolean; exp: number }>();

export type SessionValidation = {
  active: boolean;
  reason?:
    | "missing"
    | "revoked"
    | "expired"
    | "idle"
    | "version_mismatch"
    | "lookup_failed";
  record?: SessionRecord;
};

/**
 * Is the device session behind this access token still usable?
 *
 * `strict` (used when a cached answer would be unsafe) skips the cache.
 */
export async function validateSession(
  id: number,
  userId: number,
  currentSessionVersion: number,
  opts?: { strict?: boolean }
): Promise<SessionValidation> {
  if (!opts?.strict) {
    const cached = sessionStateCache.get(id);
    if (cached && Date.now() < cached.exp) {
      if (cached.ok) {
        const rec = await findSessionById(id);
        return rec
          ? { active: true, record: rec }
          : { active: false, reason: "missing" };
      }
      return { active: false, reason: "revoked" };
    }
  }
  const rec = await findSessionById(id);
  const cache = (ok: boolean) => {
    sessionStateCache.set(id, {
      ok,
      exp: Date.now() + SESSION_STATE_CACHE_TTL_MS,
    });
  };
  if (!rec) {
    cache(false);
    return { active: false, reason: "missing" };
  }
  if (rec.userId !== userId) {
    cache(false);
    return { active: false, reason: "missing" };
  }
  if (rec.revokedAt) {
    cache(false);
    return { active: false, reason: "revoked" };
  }
  if (rec.expiresAt.getTime() <= Date.now()) {
    cache(false);
    return { active: false, reason: "expired" };
  }
  // Idle timeout: a session that has not been used for AUTH_IDLE_TIMEOUT_MIN is
  // dead even if its absolute expiry has not passed. `resolveUserFromRequest`
  // calls touchSession() at most once a minute of real activity, so an in-use
  // session keeps its timestamp fresh and never trips this.
  if (Date.now() - rec.lastUsedAt.getTime() > ENV.idleTimeoutMin * 60_000) {
    cache(false);
    await revokeSessionById(rec.id, rec.userId, "idle_timeout").catch(() => {});
    return { active: false, reason: "idle" };
  }
  if (currentSessionVersion !== rec.sessionVersionAtCreation) {
    cache(false);
    return { active: false, reason: "version_mismatch" };
  }
  cache(true);
  return { active: true, record: rec };
}

export function invalidateSessionCache(id?: number): void {
  if (id == null) sessionStateCache.clear();
  else sessionStateCache.delete(id);
}

// ── Cleanup ─────────────────────────────────────────────────────────────────
// Previously `cleanupExpiredSessions()` existed but was never called, so
// `public.sessions` grew without bound. Called from the server's janitor.
export async function cleanupExpiredSessions(): Promise<{
  sessions: number;
  resets: number;
}> {
  const sql = await getSql();
  const sessions = await sql.unsafe(
    `SELECT public.cleanup_expired_sessions() AS n`
  );
  let resets = 0;
  try {
    const r = await sql.unsafe(
      `SELECT public.cleanup_expired_password_resets() AS n`
    );
    resets = Number(r?.[0]?.n ?? 0);
  } catch {
    /* function may not exist on older schemas */
  }
  const n = Number(sessions?.[0]?.n ?? 0);
  invalidateSessionCache();
  if (n > 0 || resets > 0) {
    console.log(
      `[auth] janitor removed ${n} session(s), ${resets} reset token(s)`
    );
  }
  return { sessions: n, resets };
}

/**
 * Start the janitor. Interval is unref'd so it never holds the process open,
 * and each instance runs it — the DELETE is idempotent and safe to run
 * concurrently from several instances.
 */
export function startSessionJanitor(): void {
  const run = () => {
    cleanupExpiredSessions().catch(e =>
      console.error("[auth] janitor failed:", e?.message)
    );
  };
  const timer = setInterval(run, ENV.cleanupIntervalMs);
  timer.unref?.();
  // Run shortly after boot so a crashed instance's leftovers are collected.
  const initial = setTimeout(run, 30_000);
  initial.unref?.();
}

// Helper to get the secret key for token operations (shared with auth.ts)
function getSecretKey(): Uint8Array {
  const secret = ENV.sessionSecret;
  if (!secret || secret.length < 16)
    throw new Error("SESSION_SECRET not configured properly");
  return new TextEncoder().encode(secret);
}

// Export for use in other modules
export { getSecretKey };

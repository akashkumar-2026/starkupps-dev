import { getSql } from "../db/supabase";
import { ENV } from "../config/env";
import { getClientIp, isUnknownIp } from "./client-ip";

const DEFAULT_WINDOW_MS = ENV.loginWindowMs;
const DEFAULT_MAX = ENV.loginAttemptMax;

// ── Store-backed limiter ────────────────────────────────────────────────────
// State lives in Postgres (`public.rate_limits`) so limits hold across process
// restarts and across every instance behind a load balancer. The in-memory map
// is only a fallback for when the database is unreachable (notably in tests);
// it is per-process and therefore NOT a security boundary on its own.
//
// The counter is a single atomic upsert, so concurrent requests cannot race
// past the limit.

const mem = new Map<string, { count: number; resetAt: number }>();
setInterval(() => {
  const now = Date.now();
  mem.forEach((v, k) => {
    if (now > v.resetAt) mem.delete(k);
  });
}, 60_000).unref?.();

type Result = { allowed: boolean; retryAfterMs?: number; count: number };
type ThrottleCheck = Partial<Result> & { allowed: boolean };

/** Consume one unit from `key`'s bucket and report whether it is still allowed. */
export async function consume(
  key: string,
  opts?: { max?: number; windowMs?: number }
): Promise<Result> {
  const now = Date.now();
  const max = opts?.max ?? DEFAULT_MAX;
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
  const resetAt = new Date(now + windowMs);
  try {
    const sql = await getSql();
    const rows: any[] = await sql.unsafe(
      `INSERT INTO public.rate_limits (key, count, reset_at)
       VALUES ($1, 1, $2)
       ON CONFLICT (key) DO UPDATE SET count = CASE WHEN public.rate_limits.reset_at < now() THEN 1 ELSE public.rate_limits.count + 1 END,
                                       reset_at = CASE WHEN public.rate_limits.reset_at < now() THEN $2 ELSE public.rate_limits.reset_at END
       RETURNING count, reset_at`,
      [key, resetAt.toISOString()]
    );
    const row = rows[0];
    if (!row) return { allowed: true, count: 0 };
    const count = Number(row.count);
    const resetMs = new Date(row.reset_at).getTime();
    if (count > max)
      return {
        allowed: false,
        retryAfterMs: Math.max(0, resetMs - now),
        count,
      };
    // Periodic cleanup of expired rows (best effort, opportunistic).
    if (Math.random() < 0.05) {
      sql
        .unsafe(`DELETE FROM public.rate_limits WHERE reset_at < now()`)
        .catch(() => {});
    }
    return { allowed: true, count };
  } catch {
    // Degraded: fall back to process-local state. Still better than no limit,
    // but explicitly documented as not multi-instance safe.
    const bucket = mem.get(key);
    if (!bucket || now > bucket.resetAt) {
      mem.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, count: 1 };
    }
    if (bucket.count >= max) {
      return {
        allowed: false,
        retryAfterMs: bucket.resetAt - now,
        count: bucket.count,
      };
    }
    bucket.count++;
    return { allowed: true, count: bucket.count };
  }
}

/** Read a bucket without consuming from it. */
export async function peek(
  key: string,
  opts?: { max?: number; windowMs?: number }
): Promise<Result> {
  try {
    const sql = await getSql();
    const rows: any[] = await sql.unsafe(
      `SELECT count, reset_at FROM public.rate_limits WHERE key = $1`,
      [key]
    );
    const row = rows[0];
    if (!row) return { allowed: true, count: 0 };
    const count = Number(row.count);
    const resetMs = new Date(row.reset_at).getTime();
    if (resetMs < Date.now()) return { allowed: true, count: 0 };
    const max = opts?.max ?? DEFAULT_MAX;
    return {
      allowed: count <= max,
      retryAfterMs: Math.max(0, resetMs - Date.now()),
      count,
    };
  } catch {
    const bucket = mem.get(key);
    if (!bucket || Date.now() > bucket.resetAt)
      return { allowed: true, count: 0 };
    return {
      allowed: bucket.count <= (opts?.max ?? DEFAULT_MAX),
      retryAfterMs: bucket.resetAt - Date.now(),
      count: bucket.count,
    };
  }
}

/** Drop a bucket entirely — called after a successful login. */
export async function clear(key: string): Promise<void> {
  mem.delete(key);
  try {
    const sql = await getSql();
    await sql.unsafe(`DELETE FROM public.rate_limits WHERE key = $1`, [key]);
  } catch {
    /* best effort */
  }
}

// ── Login throttling ────────────────────────────────────────────────────────
// Two independent dimensions, deliberately separated:
//
//   ATTEMPT  — every login request, generous. Guards against volumetric floods.
//   FAILURE  — only wrong-password events, strict. Guards brute force.
//
// The previous code counted *all* attempts against a 10/15min budget, which
// meant ten successful logins in a quarter hour locked the account out, and an
// unidentified caller (no X-Forwarded-For) collapsed every client into one
// shared bucket — a trivial global DoS against the admin panel.

export type LoginThrottle = {
  /** Set when the caller should be rejected outright. */
  blocked?: { reason: "rate_limited"; retryAfterMs: number };
};

export type ThrottleInput = {
  email: string;
  req: {
    socket?: { remoteAddress?: string | null };
    headers?: Record<string, any>;
  };
};

/**
 * Consume one login attempt.
 *
 * The per-IP bucket is SKIPPED when the client IP cannot be determined, rather
 * than falling back to a shared bucket: grouping unidentified callers together
 * would let one of them deny service to every real admin. The per-account
 * failure limiter still applies, so brute force against a known address
 * remains throttled.
 */
export async function consumeLoginAttempt({
  email,
  req,
}: ThrottleInput): Promise<LoginThrottle> {
  const ip = getClientIp(req as any);
  const [ipCheck, acct]: [ThrottleCheck, ThrottleCheck] = await Promise.all([
    isUnknownIp(ip)
      ? Promise.resolve({ allowed: true, count: 0 })
      : consume(`login:attempt:ip:${ip}`, {
          max: ENV.loginAttemptMax * 3,
          windowMs: ENV.loginWindowMs,
        }),
    // Per-account attempt ceiling. Uses the normalized (lowercased) email.
    consume(`login:attempt:acct:${email}`, {
      max: ENV.loginAttemptMax,
      windowMs: ENV.loginWindowMs,
    }),
  ]);
  if (!ipCheck.allowed || !acct.allowed) {
    const worst = !ipCheck.allowed ? ipCheck : acct;
    return {
      blocked: {
        reason: "rate_limited",
        retryAfterMs: worst.retryAfterMs ?? 60_000,
      },
    };
  }
  return {};
}

/** Record a failed credential check. Returns the delay the caller should apply. */
export async function consumeLoginFailure({
  email,
  req,
}: ThrottleInput): Promise<LoginThrottle> {
  // The per-IP and per-account counters are independent; charging them in
  // series doubled the latency of every failed login.
  const ip = getClientIp(req as any);
  const [ipFails, acct]: [ThrottleCheck, ThrottleCheck] = await Promise.all([
    isUnknownIp(ip)
      ? Promise.resolve({ allowed: true, count: 0 })
      : consume(`login:fail:ip:${ip}`, {
          max: ENV.loginFailureMax * 2,
          windowMs: ENV.loginWindowMs,
        }),
    consume(`login:fail:acct:${email}`, {
      max: ENV.loginFailureMax,
      windowMs: ENV.loginWindowMs,
    }),
  ]);
  if (!ipFails.allowed || !acct.allowed) {
    const worst = !ipFails.allowed ? ipFails : acct;
    return {
      blocked: {
        reason: "rate_limited",
        retryAfterMs: worst.retryAfterMs ?? 60_000,
      },
    };
  }
  return {};
}

/** Clear every failure counter for an account after a successful login. */
export async function clearLoginFailures({
  email,
  req,
}: ThrottleInput): Promise<void> {
  const keys = [`login:fail:acct:${email}`];
  const ip = getClientIp(req as any);
  if (!isUnknownIp(ip)) keys.push(`login:fail:ip:${ip}`);
  await Promise.all(keys.map(k => clear(k)));
}

/**
 * Progressive delay after N failures. A flat 15-minute lockout at 5 attempts
 * was a denial-of-service primitive against a panel where only owners can log
 * in: locking the single owner out locks out everyone, and there is no second
 * account able to undo it. Delays grow but stay short, and the hard stop is
 * the rate limiter above (which an operator can clear — see
 * `npm run auth:unlock`).
 */
export async function progressiveDelayMs(email: string): Promise<number> {
  const res = await peek(`login:fail:acct:${email}`, {
    max: ENV.loginFailureMax,
  });
  const n = res.count;
  if (n < 3) return 0;
  if (n < 5) return 400 * (n - 2);
  if (n < 8) return 1_500 * (n - 4);
  return Math.min(8_000, 3_000 * (n - 7));
}

// Sync version kept for legacy callers (tests use it)
export { checkRateLimit } from "./auth";

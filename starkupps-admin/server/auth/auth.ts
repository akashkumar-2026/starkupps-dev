import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
  randomUUID,
} from "node:crypto";
import argon2 from "argon2";
import * as jose from "jose";
import { ENV } from "../config/env";

// ── Password hashing ────────────────────────────────────────────────────────
// Primary: Argon2id (modern standard). Fallback: scrypt for legacy hashes.
// Existing scrypt hashes are transparently migrated to Argon2id on login.

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
    hashLength: 32,
  });
}

// A fixed Argon2id hash of a value nobody can supply. Verifying against it
// costs the same as verifying a real user, which is what keeps the login
// response time independent of whether the account exists (see DUMMY_HASH).
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$c3Rhcmd1cHBzLWR1bW15c2FsdA$8k1Yx0F2mQ9ZtR7bW3vNc5eLxA1sJ6uH4pG0dT2yF7iM";

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  try {
    // The `argon2` library emits standard PHC strings beginning with
    // `$argon2id$` / `$argon2i$` / `$argon2d$` (leading dollar sign). Detect by
    // the `$argon2` prefix. A previous `argon2$` check never matched real
    // hashes, so every Argon2 password silently failed verification.
    if (stored.startsWith("$argon2")) {
      return await argon2.verify(stored, password);
    }
    // Legacy scrypt hash: format `scrypt:<saltHex>:<hashHex>`.
    const parts = stored.split(":");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;
    const [, salt, hashHex] = parts;
    if (!salt || !hashHex) return false;
    const storedHash = Buffer.from(hashHex, "hex");
    const derived = scryptSync(password, salt, storedHash.length);
    if (storedHash.length === 0 || storedHash.length !== derived.length)
      return false;
    return timingSafeEqual(storedHash, derived);
  } catch {
    return false;
  }
}

/**
 * Burn the same CPU as a real verification when the account does not exist or
 * has no password set.
 *
 * Without this, login response time is a user-enumeration oracle: measured
 * ~1.3s for an unknown email versus ~2.7s for a real email with a wrong
 * password, purely because Argon2id (64 MiB) only ran in the latter case.
 */
export async function fakeVerifyDelay(): Promise<void> {
  try {
    await argon2.verify(DUMMY_HASH, randomBytes(24).toString("hex"));
  } catch {
    /* timing equalizer only — result is irrelevant */
  }
}

export function isHashedPassword(value: string): boolean {
  return value.startsWith("$argon2") || value.startsWith("scrypt:");
}

// ── Password policy ─────────────────────────────────────────────────────────
// Length plus a known-bad denylist, rather than arbitrary composition rules
// (which push users toward predictable substitutions like "Password1!").

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

// Weak stems from the standard breach corpora. Matched as substrings of the
// normalized (lowercased, punctuation-stripped) password rather than as exact
// entries, so "password1234", "MyPassword2024" and "P@ssw0rd!" are all caught.
// Exact-match lists are trivially defeated by appending a digit.
const WEAK_STEMS = [
  "password",
  "passw0rd",
  "qwerty",
  "letmein",
  "welcome",
  "admin",
  "administrator",
  "changeme",
  "iloveyou",
  "monkey",
  "dragon",
  "football",
  "baseball",
  "superman",
  "sunshine",
  "princess",
  "starwars",
  "trustno1",
  "secret",
  "123456",
  "654321",
  "zaq12wsx",
  "qazwsx",
  "1q2w3e",
  "asdfgh",
  "starupps",
  "starkupps",
  "star123",
  "cafe123",
  "root123",
  "test1234",
  "temp1234",
];

export type PasswordPolicyResult = { ok: true } | { ok: false; reason: string };

/**
 * Fold common leetspeak substitutions so "P@ssw0rd" and "p455w0rd" reduce to
 * the same base as "password". Checked alongside the plain normalized form,
 * because folding also mangles numeric runs ("123456" -> "iz3456").
 */
function leetFold(s: string): string {
  return s
    .replace(/[@4]/g, "a")
    .replace(/[8]/g, "b")
    .replace(/[(<{]/g, "c")
    .replace(/[0]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/[$5]/g, "s")
    .replace(/[+7]/g, "t")
    .replace(/[3]/g, "e");
}

/**
 * Length-first policy with a breached/common-password check.
 * Callers MUST surface the same message for every rejection so the policy
 * itself cannot be used as an oracle.
 */
export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      reason: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    };
  }
  // bcrypt/argon2 silently truncate beyond 72 bytes; reject rather than mislead.
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      reason: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
    };
  }
  // Fold leetspeak BEFORE stripping punctuation, otherwise "@" and "$" are
  // deleted first and "P@ssw0rd" reduces to "pssw0rd", which matches nothing.
  const folded = leetFold(password.toLowerCase()).replace(/[^a-z0-9]/g, "");
  const normalized = password.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.length < 4) {
    return { ok: false, reason: "Password is too simple." };
  }
  if (
    WEAK_STEMS.some(stem => normalized.includes(stem) || folded.includes(stem))
  ) {
    return {
      ok: false,
      reason:
        "That password is too common. Please choose something less predictable.",
    };
  }
  // Cheap structural rules: a single repeated character, or a password that is
  // just its own prefix repeated ("abcabcabcabc").
  if (/^(.)\1+$/.test(password)) {
    return { ok: false, reason: "Password is too simple." };
  }
  const half = Math.max(2, Math.floor(normalized.length / 2));
  const head = normalized.slice(0, half);
  if (
    normalized.length >= 8 &&
    head.length >= 2 &&
    normalized ===
      head
        .repeat(Math.ceil(normalized.length / half))
        .slice(0, normalized.length)
  ) {
    return { ok: false, reason: "Password is too simple." };
  }
  return { ok: true };
}

// ── Session tokens ──────────────────────────────────────────────────────────
// Access token lifetime comes from ENV.accessTokenSec (default 1h). The cookie
// may outlive it when "Remember on this device" is used — that longevity is
// provided by the refresh token and the persistent cookie, not by a long-lived
// JWT. A stolen cookie is therefore only useful for a short window.
const SESSION_MAX_AGE_SEC = (() => {
  const v = Number(process.env.AUTH_ACCESS_TOKEN_SEC ?? "") || 60 * 60;
  return Number.isFinite(v) && v >= 300 ? Math.floor(v) : 60 * 60;
})();

function getSecretKey(): Uint8Array {
  const secret = ENV.sessionSecret;
  if (!secret || secret.length < 16)
    throw new Error("SESSION_SECRET not configured properly");
  return new TextEncoder().encode(secret);
}

export type SessionPayload = {
  uid: number;
  openId: string;
  role: "user" | "admin";
  sv?: number; // sessionVersion for revocation
  aud?: "admin" | "pos"; // audience for Admin vs POS isolation
  sid?: number; // public.sessions.id — makes single-device revocation possible
  rem?: boolean; // device session is persistent ("remember on this device")
  rat?: number; // reauthenticated-at (epoch seconds) for sensitive actions
  iat?: number;
  exp?: number;
};

export async function createSessionToken(
  payload: Omit<SessionPayload, "iat" | "exp">,
  opts?: { maxAgeSec?: number }
): Promise<string> {
  const secret = getSecretKey();
  const aud = (payload as any).aud ?? "admin";
  const { aud: _aud, ...rest } = payload as any;
  const ttl = Math.max(60, Math.floor(opts?.maxAgeSec ?? SESSION_MAX_AGE_SEC));
  return await new jose.SignJWT({ ...rest })
    // alg is pinned: jose refuses to verify with a different algorithm when
    // given a symmetric key, so "alg: none" and algorithm-confusion attacks
    // (e.g. HS256-verified RS256 tokens) are both rejected.
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("starkupps-admin")
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .setAudience(aud)
    .sign(secret);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Opaque, high-entropy refresh token. Only its SHA-256 is ever stored. */
export function createRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createFamilyId(): string {
  return randomUUID();
}

export async function verifySessionToken(
  token: string,
  expectedAud?: "admin" | "pos"
): Promise<SessionPayload | null> {
  try {
    const secret = getSecretKey();
    const opts: any = { algorithms: ["HS256"], issuer: "starkupps-admin" };
    if (expectedAud) opts.audience = expectedAud;
    const { payload } = await jose.jwtVerify(token, secret, opts);
    if (typeof payload.uid !== "number" || typeof payload.openId !== "string")
      return null;
    // Enforce aud isolation if expected provided, else accept both for backward compat
    if (
      expectedAud &&
      (payload as any).aud &&
      (payload as any).aud !== expectedAud
    )
      return null;
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export function getSessionMaxAgeSec(): number {
  return SESSION_MAX_AGE_SEC;
}

/** Absolute lifetime of the device session backing the current access token. */
export function getAbsoluteLifetimeSec(remember: boolean): number {
  return remember
    ? ENV.rememberDays * 24 * 60 * 60
    : ENV.sessionHours * 60 * 60;
}

/** True when the session was re-authenticated recently enough for sensitive actions. */
export function isRecentlyReauthenticated(
  payload: SessionPayload | null | undefined
): boolean {
  if (!payload || typeof payload.rat !== "number") return false;
  const ageMin = (Date.now() / 1000 - payload.rat) / 60;
  return ageMin <= ENV.reauthWindowMin;
}

// ── Password reset token (single-use, short-lived) ─────────────────────────
const RESET_MAX_AGE_SEC = 60 * 60; // 1 hour

export async function createResetToken(
  userId: number,
  openId: string
): Promise<string> {
  const secret = getSecretKey();
  return await new jose.SignJWT({ uid: userId, openId, purpose: "reset" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(`${RESET_MAX_AGE_SEC}s`)
    .setJti(randomBytes(16).toString("hex"))
    .sign(secret);
}

export async function verifyResetToken(
  token: string
): Promise<{ uid: number; openId: string } | null> {
  try {
    const secret = getSecretKey();
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    if (payload.purpose !== "reset") return null;
    if (typeof payload.uid !== "number" || typeof payload.openId !== "string")
      return null;
    return { uid: payload.uid as number, openId: payload.openId as string };
  } catch {
    return null;
  }
}

// ── Order tracking token (short-lived, for customer live-status SSE) ────────
// Issued only after the caller's phone matches the order (see
// public.orders.trackToken). Lets the storefront open an EventSource without
// putting the phone number in server logs on every reconnect.
const TRACK_MAX_AGE_SEC = 15 * 60; // 15 minutes

export async function createTrackToken(orderId: number): Promise<string> {
  const secret = getSecretKey();
  return await new jose.SignJWT({ oid: orderId, purpose: "track" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(`${TRACK_MAX_AGE_SEC}s`)
    .setJti(randomBytes(16).toString("hex"))
    .sign(secret);
}

export async function verifyTrackToken(
  token: string
): Promise<{ orderId: number } | null> {
  try {
    const secret = getSecretKey();
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    if (payload.purpose !== "track") return null;
    if (typeof payload.oid !== "number") return null;
    return { orderId: payload.oid as number };
  } catch {
    return null;
  }
}

// ── In-memory rate limiter (per IP + per email) ──────────────────────────────
// NOTE: This is retained for legacy compatibility only. The production system
// uses persistent rate limiting in the database (see rateLimit.ts).
type Bucket = { count: number; resetAt: number };
const loginBuckets = new Map<string, Bucket>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 min
const RATE_LIMIT_MAX = 10;

export function checkRateLimit(key: string): {
  allowed: boolean;
  retryAfterMs?: number;
} {
  const now = Date.now();
  const bucket = loginBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    loginBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }
  if (bucket.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }
  bucket.count++;
  return { allowed: true };
}

// Periodic cleanup
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    loginBuckets.forEach((v, k) => {
      if (now > v.resetAt) loginBuckets.delete(k);
    });
  }, 60_000).unref?.();
}

// ── Helpers ─────────────────────────────────────────────────────────────────
export function sanitizeReturnTo(
  raw: string | null | undefined
): string | null {
  if (!raw) return null;
  try {
    // Decode any URL-encoding iteratively to catch %2F%2F -> // bypasses
    let decoded = raw;
    for (let i = 0; i < 3; i++) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch {
        break;
      }
    }
    // Must be a relative path starting with /
    if (!decoded.startsWith("/")) return null;
    if (decoded.startsWith("//")) return null;
    if (decoded.includes("://")) return null;
    // Reject control characters (NUL, CR, LF, TAB). Not an open-redirect risk
    // on their own, but they enable request splitting / parser confusion
    // downstream and have no place in a navigation target.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(decoded)) return null;
    // Disallow auth routes as returnTo to avoid loops
    if (decoded.startsWith("/auth/")) return null;
    // Validate URL parsing — origin must remain localhost (catches protocol-relative + encoded)
    const u = new URL(decoded, "http://localhost");
    if (u.host !== "localhost") return null;
    if (decoded.includes("\\") || decoded.toLowerCase().includes("%5c"))
      return null;
    // Re-validate raw as well (defense in depth)
    const u2 = new URL(raw, "http://localhost");
    if (u2.host !== "localhost") return null;
    // Return decoded safe path
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
}

export function genericAuthError(): string {
  return "Invalid email or password.";
}

// Audit helper - hash email for privacy-safe logging
export function hashEmailForAudit(email: string): string {
  return createHash("sha256")
    .update(email.toLowerCase().trim())
    .digest("hex")
    .slice(0, 16);
}

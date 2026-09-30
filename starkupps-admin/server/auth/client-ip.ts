import { createHash, randomBytes } from "node:crypto";
import { ENV } from "../config/env";

// ── Client IP resolution ─────────────────────────────────────────────────────
// Security-critical: the login rate limiter and every audit record key off
// this value. Two failure modes must be avoided at all costs:
//
//   1. SPOOFING — if untrusted X-Forwarded-For is believed, an attacker mints
//      an unlimited number of fresh rate-limit buckets by rotating the header,
//      which disables brute-force throttling entirely.
//   2. COLLAPSE — if the header is absent (direct connection, health checker,
//      curl, a proxy that strips it) every caller must NOT be lumped into one
//      shared bucket, or a single caller can lock out every admin.
//
// So: believe X-Forwarded-For only when a proxy is explicitly trusted, and
// take the *last* N entries rather than the first (a client-supplied prefix
// sits at the front; the proxy appends the address it actually saw).

const UNKNOWN = "unknown";

function isValidIp(value: string): boolean {
  if (!value) return false;
  if (value.length > 45) return false; // longest possible: IPv6 + zone/scope
  // Reuse the platform parser via URL's host handling is unreliable; do a
  // conservative structural check and let consumers cope with the raw string.
  return /^[0-9a-fA-F:.]{2,45}$/.test(value) && /[0-9]/.test(value);
}

/** Left-to-right hop list as seen by this server, most-recent-last. */
function forwardedChain(headerValue: string): string[] {
  return headerValue
    .split(",")
    .map(s => s.trim())
    .filter(s => s.length > 0 && isValidIp(s));
}

/**
 * Best-effort client IP. Returns UNKNOWN only when the socket address is also
 * unusable; callers must treat UNKNOWN as "not a reliable bucket key" rather
 * than grouping everyone together (see `rateLimitKeyForIp`).
 */
export function getClientIp(req: {
  socket?: { remoteAddress?: string | null };
  connection?: { remoteAddress?: string | null };
  headers?: Record<string, string | string[] | undefined>;
}): string {
  const socketIp =
    req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? "";
  const header = req.headers?.["x-forwarded-for"];
  const raw = Array.isArray(header) ? header.join(",") : header;

  if (ENV.trustProxy && raw) {
    // The right-most N entries were appended by our own trusted hops; anything
    // to the left of them was supplied by the client and is ignored.
    const hops =
      typeof ENV.trustProxy === "number" ? ENV.trustProxy : ENV.trustProxyHops;
    const chain = forwardedChain(raw);
    if (chain.length) {
      // chain is client-first; our hops are the last `hops` entries.
      const fromProxy = chain[Math.max(0, chain.length - hops)];
      if (fromProxy) return normalizeIp(fromProxy);
    }
  }

  if (socketIp) return normalizeIp(socketIp);

  // No socket address (some serverless adapters). Fall back to the header only
  // when a proxy is explicitly trusted; otherwise refuse to invent an identity.
  if (ENV.trustProxy && raw) {
    const chain = forwardedChain(raw);
    if (chain.length) return normalizeIp(chain[chain.length - 1]);
  }
  return UNKNOWN;
}

/** Node reports IPv4-mapped IPv6 as ::ffff:1.2.3.4 — store it as plain IPv4. */
export function normalizeIp(ip: string): string {
  const v = ip.trim();
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(v);
  return mapped ? mapped[1] : v;
}

export function isUnknownIp(ip: string): boolean {
  return !ip || ip === UNKNOWN;
}

// ── Throttle bucket keys ────────────────────────────────────────────────────
// When the client IP is unavailable we must NOT fall back to one shared bucket:
// that is a global denial-of-service primitive (demonstrated live — a single
// unidentified caller filled `login:ip:unknown` and blocked every admin).
//
// Fallback order:
//   1. the client IP
//   2. a coarse User-Agent fingerprint (rotatable, but far better than a
//      single global bucket)
//   3. a per-process nonce, which degrades the limit to per-instance — safe
//      against DoS, weaker against distributed flooding.

let anonymousInstanceNonce: string | null = null;
function instanceNonce(): string {
  if (!anonymousInstanceNonce) {
    anonymousInstanceNonce = createHash("sha256")
      .update(`${randomBytes(16).toString("hex")}:${Date.now()}`)
      .digest("hex")
      .slice(0, 8);
  }
  return anonymousInstanceNonce;
}

/**
 * Build a rate-limit bucket key that identifies the caller as precisely as we
 * honestly can, without ever collapsing all unknown callers into one bucket.
 */
export function clientThrottleKey(
  req: {
    socket?: { remoteAddress?: string | null };
    connection?: { remoteAddress?: string | null };
    headers?: Record<string, string | string[] | undefined>;
  },
  prefix: string
): string {
  const ip = getClientIp(req);
  if (!isUnknownIp(ip)) return `${prefix}:ip:${ip}`;
  const h = req.headers ?? {};
  const ua =
    (Array.isArray(h["user-agent"]) ? h["user-agent"][0] : h["user-agent"]) ??
    "";
  const lang =
    (Array.isArray(h["accept-language"])
      ? h["accept-language"][0]
      : h["accept-language"]) ?? "";
  const fp = `${ua}|${lang}`;
  if (fp.replace(/\|/g, "").trim().length > 0) {
    return `${prefix}:fp:${createHash("sha256").update(fp).digest("hex").slice(0, 16)}`;
  }
  return `${prefix}:anon:${instanceNonce()}`;
}

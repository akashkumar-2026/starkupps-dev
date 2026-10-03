import cookie from "cookie";
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers";
import { verifySessionToken } from "./auth/auth";
import { getSupabaseAdmin } from "./db/supabase";
import { POS_COOKIE_NAME } from "@shared/const";
import { ENV } from "./config/env";
import {
  CSRF_HEADER_NAME,
  getCsrfCookieName,
  getRefreshCookieNames,
  getSessionCookieNames,
  isSecureRequest,
  verifyCsrfToken,
} from "./auth/cookies";
import {
  startSessionJanitor,
  validateSession,
  touchSession,
} from "./auth/sessions";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory cache for user lookup to reduce DB pressure and survive transient failures (stateless, per-instance)
const userCache = new Map<string, { user: any; exp: number }>();
const USER_CACHE_TTL_MS = 30_000;

// PostgREST has been observed taking tens of seconds from a cold or degraded
// link, while the direct pooler answers the same query in well under a second.
// Give REST a short window, then fall through to the pooler.
const USER_LOOKUP_TIMEOUT_MS = 1500;

// Resolves the authenticated session for the Admin gateway.
// Reads the admin cookie first, then the POS cookie (so a browser with both
// panels open keeps working). The verified JWT `aud` is attached to the
// result as `aud`; downstream tRPC procedures enforce it — POS-audience
// sessions are rejected on Admin routes with FORBIDDEN, never silently
// upgraded. Returns the user object with an `aud` field, or null.
export async function resolveUserFromRequest(
  req: express.Request
): Promise<any | null> {
  const cookies = cookie.parse(req.headers.cookie || "");
  // Accept both the __Host- prefixed name and the legacy unprefixed one so an
  // in-flight cookie is not orphaned across a deploy.
  const adminToken = getSessionCookieNames()
    .map(n => cookies[n])
    .find(Boolean);
  const posToken = cookies[POS_COOKIE_NAME];
  // Prefer admin session; fall back to POS session so /api/auth/me can report
  // POS sessions truthfully (frontend then shows 403 on Admin UI).
  const candidates: Array<{ token: string; expectedAud: "admin" | "pos" }> = [];
  if (adminToken) candidates.push({ token: adminToken, expectedAud: "admin" });
  if (posToken) candidates.push({ token: posToken, expectedAud: "pos" });
  if (candidates.length === 0) return null;
  let payload: any = null;
  let tokenAud: "admin" | "pos" | null = null;
  for (const c of candidates) {
    const { token, expectedAud } = c;
    // Reject obvious mock tokens (vite mock sets mock-session when DB absent)
    if (!token || token === "mock-session" || token.length < 20) continue;
    // Strict audience verification first; then legacy fallback (no aud).
    let p = await verifySessionToken(token, expectedAud);
    if (!p) p = await verifySessionToken(token);
    if (!p) continue;
    const aud = (p as any).aud ?? null;
    // Cookie/audience cross-check: an admin-aud token in the POS cookie (or
    // vice versa) is treated as invalid — prevents session confusion when
    // both panels share a browser.
    if (aud && aud !== expectedAud) continue;
    payload = p;
    tokenAud = (aud as "admin" | "pos" | null) ?? expectedAud;
    break;
  }
  if (!payload) return null;
  // Prefer Supabase REST, fallback to direct Postgres on timeout/network failure
  let u: any = null;
  let dbError: unknown = null;
  try {
    const supabase = getSupabaseAdmin();
    // Bound the REST attempt. This lookup ran on EVERY authenticated request
    // with no timeout, so a slow PostgREST response (measured at 49s cold) would
    // stall the whole panel rather than just one request.
    const { data, error } = (await Promise.race([
      supabase
        .from("users")
        .select("*")
        .eq("openId", payload.openId)
        .limit(1)
        .maybeSingle(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("users lookup timed out")),
          USER_LOOKUP_TIMEOUT_MS
        )
      ),
    ])) as any;
    if (!error && data) u = data;
    else if (error) throw error;
  } catch (e) {
    dbError = e;
  }
  if (!u) {
    try {
      const { getSql } = await import("./db/supabase");
      const sql = await getSql();
      const rows: any[] = await sql.unsafe(
        `SELECT * FROM users WHERE "openId" = $1 LIMIT 1`,
        [payload.openId]
      );
      u = rows[0] ?? null;
      dbError = null; // success via fallback clears error
    } catch (e) {
      dbError = e;
    }
  }
  if (!u) {
    // If DB failed, try serve stale cache; otherwise treat as true 401
    if (dbError) {
      const cached = userCache.get(payload.openId);
      if (cached && Date.now() < cached.exp) {
        u = cached.user;
      } else {
        // Signal infra failure — caller should map to 503, not 401
        console.warn(
          "[auth] user lookup failed, no cache:",
          (dbError as any)?.message ?? dbError
        );
        throw new Error("AUTH_DB_UNAVAILABLE");
      }
    } else {
      return null;
    }
  } else {
    // Populate cache on success
    userCache.set(payload.openId, {
      user: u,
      exp: Date.now() + USER_CACHE_TTL_MS,
    });
  }
  // Account-level disable. `users.status` existed but was never checked here,
  // so a DISABLED or LOCKED account kept a working session until it expired.
  const status = (u.status ?? "ACTIVE").toString().toUpperCase();
  if (status !== "ACTIVE") return null;

  // Revocation via sessionVersion: if token sv does not match DB, the session
  // was revoked (logout / password change / "sign out everywhere").
  //
  // This is now STRICT. The previous check was `typeof sv === "number" && ...`,
  // which let a token carrying no `sv` claim bypass revocation entirely and stay
  // valid for the full 7 days — a logout could not kill it.
  const sv = (payload as any).sv;
  const currentSv = u.sessionVersion ?? 0;
  if (typeof sv !== "number" || sv !== currentSv) return null;

  // Session-backed validation: the JWT's `sid` must point at a live device
  // session. This is what makes "revoke this device" possible without a global
  // version bump. Fails closed on a lookup error only when we positively know
  // the row is gone; a DB hiccup falls through to the cache-backed path.
  const sid = (payload as any).sid;
  if (typeof sid === "number") {
    const verdict = await validateSession(sid, u.id, currentSv);
    if (!verdict.active) return null;
    if (
      verdict.record?.lastUsedAt &&
      Date.now() - verdict.record.lastUsedAt.getTime() > 60_000
    ) {
      void touchSession(sid);
    }
  }
  // Immediate revocation on disable: non-admin users whose staff record is
  // inactive/suspended/terminated are treated as unauthenticated even if the
  // JWT itself is still valid. Admin-role users have no staff gate.
  if (u.role !== "admin") {
    try {
      const supabase = getSupabaseAdmin();
      let staff: any = null;
      const { data: byUser } = await supabase
        .from("staff")
        .select("id,active,status")
        .eq("userId", u.id)
        .limit(1)
        .maybeSingle();
      staff = (byUser as any) ?? null;
      if (!staff && u.email) {
        const { data: byEmail } = await supabase
          .from("staff")
          .select("id,active,status")
          .is("userId", null)
          .eq("email", u.email)
          .limit(1)
          .maybeSingle();
        staff = (byEmail as any) ?? null;
      }
      if (
        staff &&
        (!staff.active || !["active", "on_leave"].includes(staff.status))
      )
        return null;
    } catch {
      // On DB error, fail closed only if we already know the account is bad;
      // otherwise let downstream permission checks decide (they query live).
    }
  }
  return {
    id: u.id,
    openId: u.openId,
    name: u.name,
    email: u.email,
    loginMethod: u.loginMethod,
    role: u.role,
    aud: tokenAud,
    // Device-session context, used by the sessions UI and by the
    // re-authentication gate on sensitive actions.
    sessionId: typeof sid === "number" ? sid : null,
    remember: (payload as any).rem === true,
    authPayload: payload,
    createdAt: u.createdAt ? new Date(u.createdAt as string) : new Date(),
    updatedAt: u.updatedAt ? new Date(u.updatedAt as string) : new Date(),
    lastSignedIn: u.lastSignedIn
      ? new Date(u.lastSignedIn as string)
      : new Date(),
  };
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Behind a load balancer/CDN, tell Express to read X-Forwarded-* so `req.ip`
  // and `req.protocol` are correct. Defaults to OFF: with no explicit TRUST_PROXY
  // the app is treated as directly exposed, so a client cannot spoof its own
  // address or scheme. The previous code had no trust setting at all yet read
  // those headers directly, which handed both to the attacker.
  app.set(
    "trust proxy",
    ENV.trustProxy
      ? typeof ENV.trustProxy === "number"
        ? ENV.trustProxy
        : ENV.trustProxyHops
      : false
  );
  // Do not advertise the framework.
  app.disable("x-powered-by");

  // Security headers (minimal helmet without extra dep)
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-XSS-Protection", "0");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()"
    );
    // CSP: tight default, allow self + inline needed for Vite + Supabase/img CDN + Google Maps
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' https://maps.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://*.supabase.co https://maps.googleapis.com ws: wss:; frame-ancestors 'none'"
    );
    // HSTS only when the request is genuinely over TLS. Reading
    // `x-forwarded-proto` unconditionally let any client claim https and have
    // the header injected (verified live before this fix).
    if (isSecureRequest(_req as any)) {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains"
      );
    }
    next();
  });

  // CORS for StarKupps Web (public storefront) — explicit allowlist only.
  // NEVER use `Access-Control-Allow-Origin: *` with credentials. In
  // development (non-production) localhost/127.0.0.1 are allowed for
  // convenience; in production only origins in CORS_ORIGINS are allowed.
  // Same-origin requests (Origin host === Host header, e.g. Vite `crossorigin`
  // asset fetches to /assets/*) are always allowed and never need allowlisting.
  app.use((req, res, next) => {
    const origin = req.headers.origin as string | undefined;
    const host = req.headers.host as string | undefined;
    const allowed = (process.env.CORS_ORIGINS ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    const isProd = process.env.NODE_ENV === "production";
    // Parse the origin and compare the hostname. The previous
    // `o.includes("localhost")` matched things like
    // `https://evil.com/?x=localhost` in non-production.
    const isLocalhost = (o: string): boolean => {
      try {
        const h = new URL(o).hostname;
        return (
          h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1"
        );
      } catch {
        return false;
      }
    };
    let isSameOrigin = false;
    if (origin && host) {
      try {
        isSameOrigin = new URL(origin).host === host;
      } catch {
        isSameOrigin = false;
      }
    }
    const isAllowed = !origin
      ? true
      : isSameOrigin ||
        allowed.includes(origin) ||
        (!isProd && allowed.length === 0 && isLocalhost(origin));
    if (origin && isAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    // Must list every header the browser is allowed to send, or the preflight
    // fails and the browser rejects the response.
    //
    // `Cache-Control` was missing here, and the storefront's apiGet sends
    // `Cache-Control: no-cache` on transactional reads (the menu, outlets).
    // That made every menu request fail CORS in the browser and render the
    // "Fresh menu on its way" error card, while the same request from curl
    // succeeded — curl does not enforce CORS, which is why this survived.
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With, Cache-Control, Pragma, x-csrf-token"
    );
    if (req.method === "OPTIONS") return res.status(204).end();
    // Reject cross-origin requests with an untrusted Origin outright.
    if (origin && !isAllowed) {
      return res
        .status(403)
        .json({ error: "Origin not allowed", code: "CORS_FORBIDDEN" });
    }
    next();
  });

  // CSRF guard for cookie-authenticated mutations.
  //
  // Primary defence: a signed double-submit token. The value is issued in a
  // JS-readable cookie alongside the session and must be echoed in the
  // `x-csrf-token` header. A cross-site attacker can cause the browser to send
  // the cookie, but cannot read it to set the header, so the request fails.
  //
  // Defence in depth: SameSite=Lax plus the Origin/Referer check below. The
  // token was previously missing entirely — a `csrf_tokens` table existed but no
  // code ever read it.
  app.use((req, res, next) => {
    if (
      req.method === "GET" ||
      req.method === "HEAD" ||
      req.method === "OPTIONS"
    )
      return next();
    // Cover the __Host- prefixed name as well as the legacy one.
    const hasSession = Boolean(
      req.headers.cookie &&
      /app_session_id|pos_session_id/.test(req.headers.cookie)
    );
    if (!hasSession) return next();

    // The CSRF cookie is the double-submit value; compare it to the header.
    const cookies = cookie.parse(req.headers.cookie || "");
    const expected =
      cookies[getCsrfCookieName()] ??
      cookies[`${getCsrfCookieName().replace(/^__Host-/, "")}`];
    const presented = req.headers[CSRF_HEADER_NAME] as string | undefined;
    if (expected) {
      if (!verifyCsrfToken(presented, expected)) {
        return res
          .status(403)
          .json({ error: "CSRF check failed", code: "CSRF_FORBIDDEN" });
      }
    } else {
      // No CSRF cookie issued yet (a session that predates this change, or a
      // non-browser client). Fall back to the origin check below rather than
      // locking out those callers outright.
      const originOnly = req.headers.origin as string | undefined;
      if (!originOnly)
        return res
          .status(403)
          .json({ error: "CSRF check failed", code: "CSRF_FORBIDDEN" });
    }
    const origin = req.headers.origin as string | undefined;
    const referer = req.headers.referer as string | undefined;
    const host = req.headers.host as string | undefined;
    const allowed = (process.env.CORS_ORIGINS ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    const trust = (v: string | undefined): boolean => {
      if (!v) return false;
      try {
        const u = new URL(v, `http://${host ?? "localhost"}`);
        if (host && u.host === host) return true;
        if (allowed.includes(u.origin)) return true;
        if (process.env.NODE_ENV !== "production") {
          const h = u.hostname;
          if (
            h === "localhost" ||
            h === "127.0.0.1" ||
            h === "::1" ||
            h === "[::1]"
          )
            return true;
        }
        return false;
      } catch {
        return false;
      }
    };
    // Same-origin (no Origin/Referer, e.g. same-page fetch or non-browser
    // client with cookie) is allowed; cross-site with untrusted origin is not.
    if ((origin && !trust(origin)) || (!origin && referer && !trust(referer))) {
      return res
        .status(403)
        .json({ error: "CSRF check failed", code: "CSRF_FORBIDDEN" });
    }
    next();
  });

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // ── Server-Sent Events: realtime relay (see server/realtime.ts) ──
  // Operational tables are RLS deny-by-default, so browsers cannot subscribe
  // directly. The gateway relays postgres_changes to authenticated SSE
  // connections. Clients treat SSE as best-effort; polling is the fallback.
  function openSse(res: any) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`: connected\n\n`);
  }
  function sseSend(res: any, ev: unknown, event = "change") {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(ev)}\n\n`);
    } catch {}
  }
  app.get("/api/stream/admin", async (req, res) => {
    let user: any = null;
    try {
      user = await resolveUserFromRequest(req as express.Request);
    } catch {
      return res.status(503).json({
        error: "Auth temporarily unavailable",
        code: "AUTH_DB_UNAVAILABLE",
      });
    }
    if (!user)
      return res
        .status(401)
        .json({ error: "Please login", code: "UNAUTHENTICATED" });
    // Audience isolation, matching protectedProcedure. This route previously
    // accepted any audience, so a POS session could open the Admin realtime
    // stream. POS is decommissioned today, so this is consistency rather than a
    // live exposure — but the two entry points should not diverge.
    if ((user as any)?.aud === "pos") {
      return res
        .status(403)
        .json({ error: "POS session cannot access Admin resources." });
    }
    const topic = String(req.query.topic ?? "orders");
    const { RELAY_TABLES } = await import("./realtime");
    if (!(RELAY_TABLES as readonly string[]).includes(topic))
      return res
        .status(400)
        .json({ error: `topic must be one of ${RELAY_TABLES.join("|")}` });

    // Outlet scoping only applies to the two outlet-scoped topics. Menu and
    // storefront content are global, so those subscribe once regardless of the
    // caller's outlet scope — otherwise an owner with no outlet assignment would
    // silently get no menu events at all.
    const outletScoped = topic === "orders" || topic === "deliveries";
    let outlets: Array<number | "*">;
    if (!outletScoped) {
      outlets = ["*"];
    } else {
      const { getOutletScope } = await import("./db/index");
      const scope = await getOutletScope(user);
      const param = req.query.outletId;
      if (param !== undefined && param !== "all") {
        const oid = Number(param);
        if (!Number.isInteger(oid) || oid <= 0)
          return res.status(400).json({ error: "Invalid outletId" });
        const { assertOutletAccess } = await import("./db/index");
        try {
          await assertOutletAccess(user, oid);
        } catch {
          return res
            .status(403)
            .json({ error: "You do not have access to this outlet." });
        }
        outlets = [oid];
      } else if (scope === null) {
        outlets = ["*"];
      } else if (!scope.length) {
        return res.status(403).json({ error: "No outlet assigned." });
      } else {
        outlets = scope;
      }
    }
    openSse(res);
    const { watchOutlet } = await import("./realtime");
    const unsubs = outlets.map(o =>
      watchOutlet(topic as any, o, ev => sseSend(res, ev))
    );
    const keepalive = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {}
    }, 25_000);
    req.on("close", () => {
      clearInterval(keepalive);
      for (const u of unsubs) u();
    });
  });
  app.get("/api/public/orders/stream", async (req, res) => {
    const token = String(req.query.token ?? "");
    if (!token)
      return res.status(401).json({ error: "Tracking token required." });
    const { verifyTrackToken } = await import("./auth/auth");
    const v = await verifyTrackToken(token);
    if (!v)
      return res
        .status(401)
        .json({ error: "Invalid or expired tracking token." });
    openSse(res);
    const { watchOrder } = await import("./realtime");
    const unsub = watchOrder(v.orderId, ev => sseSend(res, ev, "order"));
    const keepalive = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {}
    }, 25_000);
    req.on("close", () => {
      clearInterval(keepalive);
      unsub();
    });
  });

  app.get("/api/health", async (_req, res) => {
    // Reports whether the database and the realtime relay are actually usable.
    // `hubStatus()` used to exist but nothing ever called it, so a dead relay
    // looked identical to a healthy one from the outside.
    const { hubStatus } = await import("./realtime");
    let db: "ok" | "unreachable" = "ok";
    try {
      const { getSql } = await import("./db/supabase");
      const sql = await getSql();
      await sql.unsafe("SELECT 1");
    } catch {
      db = "unreachable";
    }
    const realtime = hubStatus();
    res.status(db === "ok" ? 200 : 503).json({
      status: db === "ok" ? "ok" : "degraded",
      database: db,
      realtime,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, private, max-age=0");
    res.setHeader("Pragma", "no-cache");
    try {
      const user = await resolveUserFromRequest(req as express.Request);
      const { getAuthState } = await import("./auth/state");
      const state = await getAuthState(user);
      // The client needs two extra signals to keep a long-lived session alive
      // without ever holding a token in JavaScript:
      //   hasRefresh — a refresh cookie exists, so this device can be renewed
      //   expiresAt  — when the current access token lapses
      // Neither value is a credential on its own.
      const cookies = cookie.parse(req.headers.cookie || "");
      const hasRefresh = getRefreshCookieNames().some(n => Boolean(cookies[n]));
      const exp = (user as any)?.authPayload?.exp;
      return res.json({
        ...state,
        hasRefresh,
        expiresAt: typeof exp === "number" ? exp * 1000 : null,
        remember: (user as any)?.remember === true,
      });
    } catch (e: any) {
      if (e?.message === "AUTH_DB_UNAVAILABLE") {
        return res.status(503).json({
          error: "Auth temporarily unavailable",
          code: "AUTH_DB_UNAVAILABLE",
        });
      }
      throw e;
    }
  });

  // ── Public REST for Web storefront (bypasses superjson/tRPC complexity) ──
  // Single source of truth: same DB, same validation as tRPC public.* routes
  const trpcHttpStatus = (code: unknown): number =>
    code === "BAD_REQUEST"
      ? 400
      : code === "UNAUTHORIZED"
        ? 401
        : code === "FORBIDDEN"
          ? 403
          : code === "NOT_FOUND"
            ? 404
            : code === "CONFLICT"
              ? 409
              : code === "TOO_MANY_REQUESTS"
                ? 429
                : 500;
  // Public REST mirrors bypass the tRPC error formatter, so scrub 5xx messages
  // here as well (unless the thrown error explicitly opted in to exposure).
  //
  // `domainCode` is forwarded because it is the storefront's only reliable way to
  // tell a fulfilment problem from a menu problem. The REST transport is the
  // *primary* path for every public endpoint, and it previously dropped the code
  // entirely — so `classifyOrderError` had nothing to work with and fell back to
  // regex-matching English prose. That fallback is what once told a customer
  // whose delivery address was rejected that "some items are unavailable at this
  // outlet". Mirrors `errorFormatter` in server/lib/trpc.ts, which promotes
  // `cause.domainCode` for the tRPC transport.
  const sendTrpcError = (res: any, e: any) => {
    const status = trpcHttpStatus(e?.code);
    const exposed = Boolean(e?.cause?.expose);
    const message =
      status >= 500 && !exposed
        ? "Something went wrong. Please try again."
        : (e?.message ?? "Request failed");
    const domainCode = e?.cause?.domainCode;
    res.status(status).json({
      error: message,
      code: e?.code,
      ...(typeof domainCode === "string" ? { domainCode } : {}),
    });
  };
  app.get("/api/public/outlets", async (_req, res) => {
    try {
      const { createCallerFactory } = await import("./lib/trpc");
      const { publicRouter } = await import("./routers/publicRouter");
      const caller = createCallerFactory(publicRouter)({
        user: null,
        aud: null,
        req: _req as any,
        res: res as any,
      });
      const data = await (caller as any).outlets.list({});
      res.json(data);
    } catch (e: any) {
      sendTrpcError(res, e);
    }
  });
  app.get("/api/public/menu", async (req, res) => {
    try {
      const outletId = req.query.outletId
        ? Number(req.query.outletId)
        : undefined;
      const { createCallerFactory } = await import("./lib/trpc");
      const { publicRouter } = await import("./routers/publicRouter");
      const caller = createCallerFactory(publicRouter)({
        user: null,
        aud: null,
        req: req as any,
        res: res as any,
      });
      const data = await (caller as any).menu.list({ outletId });
      res.json(data);
    } catch (e: any) {
      sendTrpcError(res, e);
    }
  });
  app.post("/api/public/orders", async (req, res) => {
    try {
      const { createCallerFactory } = await import("./lib/trpc");
      const { publicRouter } = await import("./routers/publicRouter");
      const caller = createCallerFactory(publicRouter)({
        user: null,
        aud: null,
        req: req as any,
        res: res as any,
      });
      const data = await (caller as any).orders.create(req.body);
      res.json(data);
    } catch (e: any) {
      sendTrpcError(res, e);
    }
  });
  app.post("/api/public/coupons/validate", async (req, res) => {
    try {
      const { createCallerFactory } = await import("./lib/trpc");
      const { publicRouter } = await import("./routers/publicRouter");
      const caller = createCallerFactory(publicRouter)({
        user: null,
        aud: null,
        req: req as any,
        res: res as any,
      });
      const data = await (caller as any).coupons.validate(req.body);
      res.json(data);
    } catch (e: any) {
      sendTrpcError(res, e);
    }
  });
  app.get("/api/public/charges", async (req, res) => {
    try {
      const outletId = Number(req.query.outletId);
      const type = String(req.query.type ?? "");
      const taxable = Number(req.query.taxable ?? 0);
      const { createCallerFactory } = await import("./lib/trpc");
      const { publicRouter } = await import("./routers/publicRouter");
      const caller = createCallerFactory(publicRouter)({
        user: null,
        aud: null,
        req: req as any,
        res: res as any,
      });
      const data = await (caller as any).settings.charges({
        outletId,
        type,
        taxable,
      });
      res.json(data);
    } catch (e: any) {
      sendTrpcError(res, e);
    }
  });
  app.post("/api/public/orders/track-token", async (req, res) => {
    try {
      const { createCallerFactory } = await import("./lib/trpc");
      const { publicRouter } = await import("./routers/publicRouter");
      const caller = createCallerFactory(publicRouter)({
        user: null,
        aud: null,
        req: req as any,
        res: res as any,
      });
      const data = await (caller as any).orders.trackToken(req.body);
      res.json(data);
    } catch (e: any) {
      sendTrpcError(res, e);
    }
  });
  // Reverse geocode for the cart's "use my current location" button.
  // POST rather than GET: the coordinates are the customer's precise position,
  // and putting them in a URL would write them into access logs and any
  // intermediate proxy's log too. Same reasoning as orders/track-token.
  app.post("/api/public/geocode", async (req, res) => {
    try {
      const { createCallerFactory } = await import("./lib/trpc");
      const { publicRouter } = await import("./routers/publicRouter");
      const caller = createCallerFactory(publicRouter)({
        user: null,
        aud: null,
        req: req as any,
        res: res as any,
      });
      const data = await (caller as any).geocode(req.body);
      res.json(data);
    } catch (e: any) {
      sendTrpcError(res, e);
    }
  });
  // Storefront business facts (contact, hours, hero, stats, trust, gallery).
  // Cacheable at the edge: it changes only when an owner edits it in the panel.
  // The SSE relay is not involved — the storefront subscribes to
  // `site_settings` over Supabase Realtime and refetches on change, so the
  // short s-maxage is only a safety net for a closed tab.
  app.get("/api/public/site", async (req, res) => {
    try {
      const { createCallerFactory } = await import("./lib/trpc");
      const { publicRouter } = await import("./routers/publicRouter");
      const caller = createCallerFactory(publicRouter)({
        user: null,
        aud: null,
        req: req as any,
        res: res as any,
      });
      const data = await (caller as any).site();
      res.setHeader(
        "Cache-Control",
        "public, max-age=30, s-maxage=60, stale-while-revalidate=600"
      );
      res.json(data);
    } catch (e: any) {
      sendTrpcError(res, e);
    }
  });

  // Customer reviews for the storefront trust section, managed in
  // Content > Testimonials. Same caching rationale as /api/public/site.
  app.get("/api/public/reviews", async (req, res) => {
    try {
      const { createCallerFactory } = await import("./lib/trpc");
      const { publicRouter } = await import("./routers/publicRouter");
      const caller = createCallerFactory(publicRouter)({
        user: null,
        aud: null,
        req: req as any,
        res: res as any,
      });
      const data = await (caller as any).reviews();
      res.setHeader(
        "Cache-Control",
        "public, max-age=30, s-maxage=60, stale-while-revalidate=600"
      );
      res.json(data);
    } catch (e: any) {
      sendTrpcError(res, e);
    }
  });

  app.get("/api/public/faqs", async (req, res) => {
    try {
      const { createCallerFactory } = await import("./lib/trpc");
      const { publicRouter } = await import("./routers/publicRouter");
      const caller = createCallerFactory(publicRouter)({
        user: null,
        aud: null,
        req: req as any,
        res: res as any,
      });
      const data = await (caller as any).faqs();
      res.setHeader(
        "Cache-Control",
        "public, max-age=30, s-maxage=60, stale-while-revalidate=600"
      );
      res.json(data);
    } catch (e: any) {
      sendTrpcError(res, e);
    }
  });

  // Instagram feed. Public read, so it is cacheable at the edge; the storefront
  // section polls on a ~60s window and the Admin panel is the only writer.
  // `stale-while-revalidate` keeps the home page snappy while an edit lands.
  app.get("/api/public/instagram", async (req, res) => {
    try {
      const { createCallerFactory } = await import("./lib/trpc");
      const { publicRouter } = await import("./routers/publicRouter");
      const caller = createCallerFactory(publicRouter)({
        user: null,
        aud: null,
        req: req as any,
        res: res as any,
      });
      const data = await (caller as any).instagram();
      res.setHeader(
        "Cache-Control",
        "public, max-age=30, s-maxage=60, stale-while-revalidate=300"
      );
      res.json(data);
    } catch (e: any) {
      sendTrpcError(res, e);
    }
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext: async ({ req, res }) => {
        try {
          const user = await resolveUserFromRequest(req as express.Request);
          return {
            user,
            aud: (user as any)?.aud ?? null,
            req: req as any,
            res: res as any,
          };
        } catch (e: any) {
          if (e?.message === "AUTH_DB_UNAVAILABLE") {
            // Surface as 503 so client can retry instead of treating as 401
            throw new (await import("@trpc/server")).TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Auth temporarily unavailable. Please retry.",
              cause: { expose: true },
            });
          }
          throw e;
        }
      },
      onError: ({ error, path }) => {
        console.error(`[tRPC] ${path} failed:`, error.message);
      },
    })
  );

  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(staticPath, "index.html"), err => {
      if (err) next();
    });
  });

  app.use("/api/*", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Terminal error handler. Without this, a throw inside an async route handler
  // fell through to Express's default handler, which renders an HTML page
  // containing a stack trace — bypassing both the tRPC errorFormatter and the
  // REST scrub above. Must keep all four parameters for Express to recognise it.
  app.use(
    (
      err: any,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      const status =
        typeof err?.status === "number" && err.status >= 400 && err.status < 600
          ? err.status
          : 500;
      if (status >= 500) {
        // Log server-side with context; never echo the message or stack back.
        console.error(
          `[api] ${req.method} ${req.path} failed:`,
          err?.message ?? err
        );
        if (process.env.NODE_ENV !== "production") console.error(err?.stack);
      }
      if (res.headersSent) return;
      if (req.path.startsWith("/api/")) {
        res.status(status).json({
          error:
            status >= 500
              ? "Something went wrong. Please try again."
              : (err?.message ?? "Request failed"),
          code: err?.code,
        });
        return;
      }
      res
        .status(status)
        .type("text/plain")
        .send(status >= 500 ? "Internal Server Error" : "Request failed");
    }
  );

  // Prune expired sessions and reset tokens. Previously `cleanupExpiredSessions`
  // existed but was never called, so `public.sessions` grew without bound.
  startSessionJanitor();

  // Open the database connection up front so the first real request does not pay
  // the cold-start cost. Deliberately not awaited: the server must still come up
  // (and serve /api/health) if the database is briefly unavailable.
  void (await import("./db/supabase")).warmDatabase();

  const port = Number(process.env.PORT) || 3000;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    console.log(`tRPC at http://localhost:${port}/api/trpc`);
  });
}

startServer().catch(console.error);

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  AUTH_REQUIRED_MSG,
  GENERIC_AUTH_MSG,
  RATE_LIMIT_MSG,
  SESSION_EXPIRED_MSG,
  SESSION_REVOKED_MSG,
  UNAUTHORIZED_MSG,
} from "@shared/const";
import { getOutletScope, recordAudit, resolveStaffRole } from "../db/index";
import {
  checkPasswordPolicy,
  createFamilyId,
  createRefreshToken,
  createResetToken,
  createSessionToken,
  fakeVerifyDelay,
  getAbsoluteLifetimeSec,
  hashEmailForAudit,
  hashPassword,
  hashToken,
  isRecentlyReauthenticated,
  PASSWORD_MIN_LENGTH,
  sanitizeReturnTo,
  verifyPassword,
  verifyResetToken,
} from "../auth/auth";
import {
  clearLoginFailures,
  consumeLoginAttempt,
  consumeLoginFailure,
  progressiveDelayMs,
} from "../auth/rate-limit";
import { sendPasswordResetEmail } from "../lib/mailer";
import {
  createCsrfToken,
  getCsrfCookieName,
  getCsrfCookieOptions,
  getCsrfClearCookieOptions,
  getRefreshClearCookieOptions,
  getRefreshCookieName,
  getRefreshCookieNames,
  getRefreshCookieOptions,
  getSessionClearCookieOptions,
  getSessionCookieName,
  getSessionCookieOptions,
  parseCookies,
} from "../auth/cookies";
import { getClientIp } from "../auth/client-ip";
import { getSql, getSupabaseAdmin } from "../db/supabase";
import {
  createSession,
  describeDevice,
  invalidateSessionCache,
  listActiveSessions,
  revokeAllSessionsForUser,
  revokeOtherSessions,
  revokeSessionById,
  rotateSession,
  touchSession,
} from "../auth/sessions";
import { ENV } from "../config/env";
import { systemRouter } from "../routers/system";
import { protectedProcedure, publicProcedure, router } from "../lib/trpc";
import { adminRouter } from "./adminRouter";
import {
  analyticsRouter,
  loyaltyRouter,
  notificationsRouter,
  searchRouter,
  settingsRouter,
  shiftsRouter,
} from "./operationsRouter";
import { auditRouter } from "./auditRouter";
import { contentRouter } from "./contentRouter";
import { couponsRouter } from "./couponsRouter";
import { customersRouter } from "./customersRouter";
import { deliveryRouter } from "./deliveryRouter";
import { financeRouter } from "./financeRouter";
import { instagramRouter } from "./instagramRouter";
import { inventoryRouter } from "./inventoryRouter";
import { marketingRouter } from "./marketingRouter";
import { outletsRouter } from "./outletsRouter";
import { publicRouter } from "./publicRouter";
import { staffWorkforceRouter } from "./staffWorkforceRouter";
import { supportRouter } from "./supportRouter";

const emailSchema = z.string().trim().toLowerCase().email().max(320);
// Login must not leak the policy, so it only bounds the length. New passwords
// are held to checkPasswordPolicy() (length + common-password denylist).
const loginPasswordSchema = z.string().min(1).max(256);
const passwordSchema = z.string().min(1).max(256);

const REAUTH_ERR_MSG =
  "For your security, please re-enter your password to confirm this change.";

// Supabase REST (PostgREST) can stall on flaky networks while the direct
// Postgres pooler stays reachable. Race REST against a timeout so a stalled
// lookup fails fast instead of hanging the request indefinitely.
// PostgREST latency is far higher than the direct pooler in practice (measured
// 5-50s vs ~0.4s for an equivalent statement), so the REST window is kept short:
// waiting out a slow REST call before falling back is strictly worse than
// going straight to SQL.
const REST_TIMEOUT_MS = 2500;
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
  // Promise.resolve normalizes supabase-js thenables (PostgrestBuilder)
  // into real promises that support .finally.
  return Promise.race([Promise.resolve(p), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

// Best-effort users-table write: REST with timeout, direct-SQL fallback.
// Used on hot paths (login) so a stalled PostgREST never hangs a request.
async function updateUserById(
  id: number,
  patch: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await withTimeout(
      supabase
        .from("users")
        .update(patch as any)
        .eq("id", id),
      REST_TIMEOUT_MS,
      "users update"
    );
    if (error) throw error;
  } catch {
    const sql = await getSql();
    const keys = Object.keys(patch);
    const sets = keys.map((k, i) => `"${k}" = $${i + 2}`).join(", ");
    await sql.unsafe(`UPDATE users SET ${sets} WHERE id = $1`, [
      id,
      ...keys.map(k => (patch as any)[k]),
    ]);
  }
}

/** Clear the access + refresh cookies. Attributes must match the set call. */
/**
 * Clear the access, refresh and CSRF cookies.
 *
 * No `maxAge` here: Express already expires a cleared cookie, and passing
 * `options.maxAge` is deprecated (ignored in Express 5). The attributes that
 * must match the `Set-Cookie` are still repeated, or the browser will keep the
 * original cookie.
 */
function clearAuthCookies(res: any): void {
  try {
    res?.clearCookie?.(getSessionCookieName(), getSessionClearCookieOptions());
    res?.clearCookie?.(getRefreshCookieName(), getRefreshClearCookieOptions());
    res?.clearCookie?.(getCsrfCookieName(), getCsrfClearCookieOptions());
  } catch {}
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    // Public, non-sensitive login-page configuration. Lets the UI state the
    // real remember window instead of hard-coding a number that can drift from
    // AUTH_REMEMBER_DAYS.
    config: publicProcedure.query(() => ({
      rememberDays: ENV.rememberDays,
      passwordMinLength: PASSWORD_MIN_LENGTH,
    })),

    me: publicProcedure.query(async ({ ctx }) => {
      if (!ctx.user) return null;
      const { getAuthState } = await import("../auth/state");
      return getAuthState(ctx.user);
    }),

    bootstrap: publicProcedure.query(async ({ ctx }) => {
      if (!ctx.user)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: AUTH_REQUIRED_MSG,
        });
      const { getAuthState } = await import("../auth/state");
      const s = await getAuthState(ctx.user);
      return {
        staffRole: s.staffRole,
        outletScope: s.outletScope,
        user: s.user!,
      };
    }),

    // ── Login ──────────────────────────────────────────────────────────────
    // Two cookies are issued:
    //   * access  — short-lived HS256 JWT, `sid` claim links it to a session row
    //   * refresh — opaque high-entropy token, stored server-side as SHA-256 only
    // "Remember on this device" controls the cookies' persistence and the
    // session row's absolute lifetime; it never affects the password or the
    // verification path.
    login: publicProcedure
      .input(
        z.object({
          email: emailSchema,
          password: loginPasswordSchema,
          returnTo: z.string().max(500).optional(),
          remember: z.boolean().optional().default(false),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const ip = getClientIp(ctx.req as any);
        const userAgent = (ctx.req.headers["user-agent"] as string) ?? null;
        const remember = input.remember === true;
        const throttleInput = { email: input.email, req: ctx.req as any };

        // 1) Attempt ceiling (generous; guards volumetric floods). Successful
        //    logins do NOT consume the failure budget.
        const attempt = await consumeLoginAttempt(throttleInput);
        if (attempt.blocked) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: RATE_LIMIT_MSG,
          });
        }

        // 2) Look up the account. Emails are normalized on input and a unique
        //    index on lower(email) guarantees at most one row.
        //
        //    The direct pooler is tried FIRST here, unlike the rest of the
        //    codebase. PostgREST was measured taking up to 49s on a cold link
        //    while the pooler answered the same query in under a second, and
        //    login is the request a user is actively waiting on. PostgREST is
        //    kept as a fallback so nothing is lost if the pooler is the side
        //    that is unavailable.
        let dbUser: any = null;
        try {
          const sql = await getSql();
          const rows: any[] = await sql.unsafe(
            "SELECT * FROM users WHERE email = $1 LIMIT 1",
            [input.email]
          );
          dbUser = rows[0] ?? null;
        } catch {
          try {
            const supabase = getSupabaseAdmin();
            const { data, error } = await withTimeout(
              supabase
                .from("users")
                .select("*")
                .eq("email", input.email)
                .limit(1)
                .maybeSingle(),
              REST_TIMEOUT_MS,
              "users lookup"
            );
            if (error) throw error;
            dbUser = data ?? null;
          } catch {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message:
                "Unable to sign in right now. Please check your connection and try again.",
              cause: { expose: true },
            });
          }
        }

        // Every rejection below runs through this closure, which performs the
        // SAME sequence of work regardless of whether the account exists.
        //
        // This is deliberate. Measured before the fix, login answered an
        // unknown address in ~1.3s but a real address with a wrong password in
        // ~2.7s — a reliable enumeration oracle. Argon2id only accounted for
        // part of that; the rest was the extra database round trips the
        // known-account failure path performs (throttle write, delay probe,
        // lockout counter update, audit write). All of it is now paid on both
        // paths, with the Argon2 cost equalized by fakeVerifyDelay().
        const reject = async (reason: string): Promise<never> => {
          // 1. Match the Argon2 cost when there is no hash to verify against.
          if (!dbUser || !dbUser.passwordHash) {
            await fakeVerifyDelay();
          }

          // 2/3/4 run together. Throttling, the lockout counter and the audit
          //     row are independent writes, so issuing them sequentially made
          //     the login path take the sum of three database round trips
          //     instead of the slowest one. The delay probe is sequenced after
          //     the throttle write because it reads the updated count.
          // Advisory only, and deliberately NOT awaited. Enforcement lives in
          // the store-backed limiter above, which runs on every path; keeping
          // this off the critical path is what makes the two paths cost the
          // same (an extra awaited write only for real accounts was itself a
          // measurable enumeration signal). The write is also idempotent, so
          // losing it on a crash only costs a hint in the users table.
          const lockoutWrite = async () => {
            if (!dbUser?.id || reason !== "bad_password") return;
            try {
              const attempts = (dbUser.failedLoginAttempts ?? 0) + 1;
              // Kept short and operator-recoverable (see `npm run auth:unlock`)
              // so this cannot be used to lock the only owner out permanently.
              const lockUntil =
                attempts >= ENV.loginFailureMax
                  ? new Date(Date.now() + 15 * 60 * 1000)
                  : null;
              await updateUserById(dbUser.id, {
                failedLoginAttempts: attempts,
                lockedUntil: lockUntil ? lockUntil.toISOString() : null,
              });
            } catch {}
          };
          if (dbUser?.id && reason === "bad_password") void lockoutWrite();

          const [throttle] = await Promise.all([
            // Identical for unknown and known accounts, so request duration
            // cannot be used to tell them apart.
            consumeLoginFailure(throttleInput),
            // Never records the password; the address is stored only as a hash.
            // Non-blocking and identical on both paths, so it neither adds
            // latency nor becomes a timing signal.
            recordAudit({
              // null, not 0: the column is foreign-keyed, and an unknown
              // address has no actor row to point at.
              actorUserId: dbUser?.id ?? null,
              entityType: "auth",
              action:
                reason === "bad_password" ? "login_failure" : "login_blocked",
              success: false,
              ip,
              userAgent,
              after: { reason, emailHash: hashEmailForAudit(input.email) },
            }).catch(() => {}),
          ]);

          const delayMs = await progressiveDelayMs(input.email);
          if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));

          // Honour the strict failure budget. This was previously computed and
          // then discarded, so the per-account failure limiter counted but
          // never actually blocked anything — leaving only the much looser
          // attempt budget as the real backstop against brute force.
          //
          // Trade-off, stated plainly: in a panel where only owners can sign
          // in, ANY per-account lockout can deny service to every admin. That
          // is why the lockout is short, the message is generic, every lockout
          // is audited, and `npm run auth:unlock -- <email>` recovers it in one
          // command. Raise AUTH_LOGIN_FAILURE_MAX (and the window) to loosen.
          if (throttle.blocked) {
            try {
              await recordAudit({
                actorUserId: dbUser?.id ?? null,
                entityType: "auth",
                action: "login_throttled",
                success: false,
                ip,
                userAgent,
              });
            } catch {}
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: RATE_LIMIT_MSG,
            });
          }

          // 5. One message for every pre-authentication failure, so the
          //    response cannot be used to distinguish a wrong password from a
          //    locked, disabled or non-existent account. A "suspended"
          //    message is only ever shown once the password has been proven
          //    correct (see below), which is not an enumeration oracle.
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: GENERIC_AUTH_MSG,
          });
        };

        if (!dbUser || !dbUser.passwordHash) await reject("unknown_account");

        // Account-level disable/lock. `users.status` existed but was never
        // enforced, so DISABLED accounts could still authenticate.
        // Checked BEFORE the password so a disabled account cannot be probed,
        // and reported with the same generic message as any other failure.
        const status = (dbUser.status ?? "ACTIVE").toString().toUpperCase();
        if (status === "DISABLED") await reject("suspended");
        if (status === "LOCKED") await reject("locked");

        if (
          dbUser.lockedUntil &&
          new Date(dbUser.lockedUntil as string) > new Date()
        ) {
          await reject("locked");
        }

        const valid = await verifyPassword(input.password, dbUser.passwordHash);
        if (!valid) await reject("bad_password");

        // Past this point the password is proven, so explaining WHY access is
        // still refused is safe and actionable — it is not an oracle, because
        // reaching it already required the correct password.

        // Transparent migration: legacy scrypt hashes become argon2id on
        // successful login (best-effort; login succeeds even if it fails).
        if (
          typeof dbUser.passwordHash === "string" &&
          dbUser.passwordHash.startsWith("scrypt:")
        ) {
          try {
            const migrated = await hashPassword(input.password);
            const supabase = getSupabaseAdmin();
            await withTimeout(
              supabase
                .from("users")
                .update({
                  passwordHash: migrated,
                  password_alg: "argon2id",
                } as any)
                .eq("id", dbUser.id),
              REST_TIMEOUT_MS,
              "password hash migration"
            );
            dbUser.passwordHash = migrated;
          } catch {}
        }

        if (dbUser.role !== "admin") {
          const tempUser = {
            id: dbUser.id,
            role: dbUser.role as "user" | "admin",
            email: dbUser.email,
          };
          const staffRole = await resolveStaffRole(tempUser);
          if (!staffRole) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: UNAUTHORIZED_MSG,
            });
          }
          // Strict Admin isolation: only owner may login via Admin panel; POS staff must use POS
          if (staffRole !== "owner") {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "Admin panel requires owner role. Please use POS panel for staff accounts.",
            });
          }
        }

        try {
          await updateUserById(dbUser.id, {
            failedLoginAttempts: 0,
            lockedUntil: null,
            lastSignedIn: new Date().toISOString(),
          });
        } catch {}
        await clearLoginFailures(throttleInput);

        // ── Issue the device session ──────────────────────────────────────
        const sv = (dbUser.sessionVersion ?? 0) as number;
        const refreshToken = createRefreshToken();
        const session = await createSession({
          userId: dbUser.id,
          audience: "admin",
          refreshToken,
          familyId: createFamilyId(),
          remember,
          userAgent,
          ipAddress: ip === "unknown" ? null : ip,
          sessionVersion: sv,
        });

        const nowSec = Math.floor(Date.now() / 1000);
        const token = await createSessionToken({
          uid: dbUser.id,
          openId: dbUser.openId,
          role: dbUser.role,
          sv,
          aud: "admin",
          sid: session.id,
          rem: remember,
          // Fresh password verification => the session counts as re-authenticated
          // for the sensitive-action window.
          rat: nowSec,
        } as any);

        const lifetimeSec = getAbsoluteLifetimeSec(remember);
        const cookieName = getSessionCookieName();
        if (ctx.res.cookie) {
          ctx.res.cookie(
            cookieName,
            token,
            getSessionCookieOptions({ remember, maxAgeSec: lifetimeSec })
          );
          ctx.res.cookie(
            getRefreshCookieName(),
            refreshToken,
            getRefreshCookieOptions({ remember, maxAgeSec: lifetimeSec })
          );
          // CSRF double-submit token: readable by JS so the SPA can echo it in
          // the x-csrf-token header on every state-changing request.
          ctx.res.cookie(
            getCsrfCookieName(),
            await createCsrfToken(),
            getCsrfCookieOptions()
          );
        }

        // Best-effort and off the critical path: the audit row is written
        // asynchronously so a slow log sink cannot add seconds to every login.
        try {
          void recordAudit({
            actorUserId: dbUser.id,
            entityType: "auth",
            action: "login_success",
            success: true,
            ip,
            userAgent,
            after: {
              remember,
              sessionId: session.id,
              device: describeDevice(userAgent),
              lifetimeDays: remember ? Math.round(lifetimeSec / 86400) : 0,
            },
          }).catch(() => {});
        } catch {}

        const staffRole =
          dbUser.role === "admin"
            ? "owner"
            : await resolveStaffRole({
                id: dbUser.id,
                role: dbUser.role,
                email: dbUser.email,
              });
        const outletScope = await getOutletScope({
          id: dbUser.id,
          role: dbUser.role,
          email: dbUser.email,
        });

        const safeReturnTo = sanitizeReturnTo(input.returnTo ?? null);

        return {
          success: true as const,
          user: {
            id: dbUser.id,
            openId: dbUser.openId,
            name: dbUser.name,
            email: dbUser.email,
            role: dbUser.role,
          },
          staffRole: staffRole ?? null,
          outletScope,
          returnTo: safeReturnTo,
          remember,
          session: {
            id: session.id,
            expiresAt: session.expiresAt.toISOString(),
            remember,
          },
        };
      }),

    // ── Refresh (rotating) ─────────────────────────────────────────────────
    // Exchanges the refresh cookie for a new access token AND a new refresh
    // token. The old token is retired, not deleted, so replaying it is
    // detectable: presenting a rotated token revokes the whole family.
    refresh: publicProcedure.mutation(async ({ ctx }) => {
      const cookies = parseCookies(
        ctx.req.headers["cookie"] as string | undefined
      );
      const presented = getRefreshCookieNames()
        .map(n => cookies[n])
        .find(Boolean);
      if (!presented)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: SESSION_EXPIRED_MSG,
        });

      const supabase = getSupabaseAdmin();
      const nextToken = createRefreshToken();
      // The successor inherits the rotation family and session-version binding
      // from the row it replaces.
      const result = await rotateSession(hashToken(presented), {
        refreshToken: nextToken,
      });

      if (result.status === "reuse") {
        // Someone replayed a rotated token: assume theft, kill the family and
        // force a fresh sign-in. Also drop the local cookies.
        clearAuthCookies(ctx.res as any);
        try {
          await recordAudit({
            actorUserId: result.userId,
            entityType: "auth",
            action: "session_reuse_detected",
            success: false,
            ip: getClientIp(ctx.req as any),
            userAgent: (ctx.req.headers["user-agent"] as string) ?? null,
          });
        } catch {}
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: SESSION_REVOKED_MSG,
        });
      }
      if (result.status !== "ok") {
        clearAuthCookies(ctx.res as any);
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            result.status === "expired"
              ? SESSION_EXPIRED_MSG
              : SESSION_REVOKED_MSG,
        });
      }

      const session = result.session;
      // Re-read the authoritative sessionVersion; a bump (password change,
      // "sign out everywhere") must not be laundered by a rotation.
      //
      // A failed lookup must NOT be treated as version 0. Doing so made every
      // slow PostgREST response look like a version mismatch, which revoked the
      // whole family and logged the user out. On a genuine infrastructure
      // failure we return 503 and leave the session intact, exactly as
      // resolveUserFromRequest does elsewhere.
      const fresh = await withTimeout(
        (async () => {
          try {
            const { data, error } = await supabase
              .from("users")
              .select("sessionVersion,openId,role,status")
              .eq("id", session.userId)
              .limit(1)
              .maybeSingle();
            if (!error && data) return data as any;
          } catch {}
          // Fall back to the direct pooler, which is markedly more reliable.
          const sql = await getSql();
          const rows: any[] = await sql.unsafe(
            "SELECT sessionVersion, openId, role, status FROM users WHERE id = $1 LIMIT 1",
            [session.userId]
          );
          if (rows[0]) return rows[0];
          throw new Error("user row missing");
        })(),
        REST_TIMEOUT_MS * 3,
        "refresh version lookup"
      ).catch(() => null);
      if (!fresh) {
        clearAuthCookies(ctx.res as any);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Auth temporarily unavailable. Please retry.",
          cause: { expose: true },
        });
      }
      const sv = (fresh as any)?.sessionVersion ?? 0;
      if (sv !== session.sessionVersionAtCreation) {
        await revokeAllSessionsForUser(
          session.userId,
          "session_version_changed"
        );
        clearAuthCookies(ctx.res as any);
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: SESSION_REVOKED_MSG,
        });
      }
      if (
        ((fresh as any)?.status ?? "ACTIVE").toString().toUpperCase() !==
        "ACTIVE"
      ) {
        await revokeAllSessionsForUser(session.userId, "account_status");
        clearAuthCookies(ctx.res as any);
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: SESSION_REVOKED_MSG,
        });
      }

      const token = await createSessionToken({
        uid: session.userId,
        openId: (fresh as any)?.openId ?? "",
        role: ((fresh as any)?.role ?? "user") as "user" | "admin",
        sv,
        aud: "admin",
        sid: session.id,
        rem: session.remember,
        // A rotation is NOT a re-authentication: it proves possession of the
        // refresh token, not knowledge of the password. Sensitive actions must
        // still ask for the password.
        rat: undefined,
      } as any);

      const lifetimeSec = getAbsoluteLifetimeSec(session.remember);
      if (ctx.res.cookie) {
        ctx.res.cookie(
          getSessionCookieName(),
          token,
          getSessionCookieOptions({
            remember: session.remember,
            maxAgeSec: lifetimeSec,
          })
        );
        ctx.res.cookie(
          getRefreshCookieName(),
          nextToken,
          getRefreshCookieOptions({
            remember: session.remember,
            maxAgeSec: lifetimeSec,
          })
        );
      }
      void touchSession(session.id);
      return {
        success: true as const,
        remember: session.remember,
        expiresAt: session.expiresAt.toISOString(),
      };
    }),

    // ── Logout ─────────────────────────────────────────────────────────────
    // Revokes ONLY the current device session. The previous implementation
    // bumped users.sessionVersion, which signed the user out of every device
    // — surprising, and it made "sign out other devices" impossible.
    logout: publicProcedure.mutation(async ({ ctx }) => {
      // Cookies go first and unconditionally: logout must succeed and return
      // promptly even if the database is slow or down, so server-side
      // revocation is best-effort and bounded.
      clearAuthCookies(ctx.res as any);
      const sessionId = (ctx.user as any)?.sessionId ?? null;
      if (ctx.user) {
        if (sessionId != null) {
          await Promise.race([
            revokeSessionById(sessionId, ctx.user.id, "logout").catch(() => {}),
            new Promise(r => setTimeout(r, 1500)),
          ]);
        }
        invalidateSessionCache(sessionId ?? undefined);
        try {
          // Time-boxed: the audit write is best-effort and must not delay the
          // response (it previously raced at 1.2s; that guarantee is kept).
          await Promise.race([
            recordAudit({
              actorUserId: ctx.user.id,
              entityType: "auth",
              action: "logout",
              success: true,
              ip: getClientIp(ctx.req as any),
              userAgent: (ctx.req.headers["user-agent"] as string) ?? null,
              after: { sessionId },
            }),
            new Promise(r => setTimeout(r, 1200)),
          ]);
        } catch {}
      }
      return { success: true } as const;
    }),

    // ── Device sessions ────────────────────────────────────────────────────
    sessions: router({
      list: protectedProcedure.query(async ({ ctx }) => {
        const rows = await listActiveSessions(ctx.user.id, "admin");
        const currentId = (ctx.user as any)?.sessionId ?? null;
        return rows.map(r => ({ ...r, isCurrent: r.id === currentId }));
      }),

      revoke: protectedProcedure
        .input(z.object({ sessionId: z.number().int().positive() }))
        .mutation(async ({ ctx, input }) => {
          const currentId = (ctx.user as any)?.sessionId ?? null;
          if (input.sessionId === currentId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Use Sign out to end the session you are currently using.",
            });
          }
          // revokeSessionById is scoped to ctx.user.id, so a session id
          // belonging to another account is simply not found (no IDOR).
          const ok = await revokeSessionById(
            input.sessionId,
            ctx.user.id,
            "revoked_by_user"
          );
          if (!ok) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "That session no longer exists.",
            });
          }
          invalidateSessionCache(input.sessionId);
          try {
            await recordAudit({
              actorUserId: ctx.user.id,
              entityType: "auth",
              action: "session_revoked",
              success: true,
              ip: getClientIp(ctx.req as any),
              after: { sessionId: input.sessionId },
            });
          } catch {}
          return { success: true } as const;
        }),

      revokeOthers: protectedProcedure.mutation(async ({ ctx }) => {
        const currentId = (ctx.user as any)?.sessionId ?? null;
        const n = await revokeOtherSessions(
          ctx.user.id,
          currentId,
          "revoke_others",
          "admin"
        );
        invalidateSessionCache();
        try {
          await recordAudit({
            actorUserId: ctx.user.id,
            entityType: "auth",
            action: "sessions_revoked_others",
            success: true,
            ip: getClientIp(ctx.req as any),
            after: { count: n },
          });
        } catch {}
        return { success: true as const, revoked: n };
      }),
    }),

    // ── Re-authentication ──────────────────────────────────────────────────
    // Verifies the current password and re-issues the access token with a
    // fresh `rat` claim, unlocking sensitive actions for the next
    // AUTH_REAUTH_WINDOW_MIN minutes. Safe to call while already signed in.
    reauthenticate: protectedProcedure
      .input(z.object({ password: loginPasswordSchema }))
      .mutation(async ({ ctx, input }) => {
        const throttled = await consumeLoginAttempt({
          email: ctx.user.email ?? "unknown",
          req: ctx.req as any,
        });
        if (throttled.blocked) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: RATE_LIMIT_MSG,
          });
        }
        const supabase = getSupabaseAdmin();
        const { data } = await withTimeout(
          supabase
            .from("users")
            .select("*")
            .eq("id", ctx.user.id)
            .limit(1)
            .maybeSingle(),
          REST_TIMEOUT_MS,
          "reauth lookup"
        );
        const u: any = data;
        const valid = u?.passwordHash
          ? await verifyPassword(input.password, u.passwordHash)
          : await (async () => {
              await fakeVerifyDelay();
              return false;
            })();
        if (!valid) {
          await consumeLoginFailure({
            email: ctx.user.email ?? "unknown",
            req: ctx.req as any,
          });
          try {
            await recordAudit({
              actorUserId: ctx.user.id,
              entityType: "auth",
              action: "reauth_failed",
              success: false,
              ip: getClientIp(ctx.req as any),
            });
          } catch {}
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "That password is incorrect.",
          });
        }
        await clearLoginFailures({
          email: ctx.user.email ?? "unknown",
          req: ctx.req as any,
        });

        const sv = (u.sessionVersion ?? 0) as number;
        const sessionId = (ctx.user as any)?.sessionId;
        const remember = (ctx.user as any)?.remember === true;
        const token = await createSessionToken({
          uid: u.id,
          openId: u.openId,
          role: u.role,
          sv,
          aud: "admin",
          sid: sessionId,
          rem: remember,
          rat: Math.floor(Date.now() / 1000),
        } as any);
        if (ctx.res.cookie) {
          ctx.res.cookie(
            getSessionCookieName(),
            token,
            getSessionCookieOptions({ remember })
          );
        }
        try {
          await recordAudit({
            actorUserId: ctx.user.id,
            entityType: "auth",
            action: "reauthenticated",
            success: true,
            ip: getClientIp(ctx.req as any),
          });
        } catch {}
        return { success: true as const };
      }),

    forgotPassword: publicProcedure
      .input(z.object({ email: emailSchema }))
      .mutation(async ({ ctx, input }) => {
        const ip = getClientIp(ctx.req as any);
        const throttleInput = { email: input.email, req: ctx.req as any };
        const attempt = await consumeLoginAttempt(throttleInput);
        if (attempt.blocked)
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: RATE_LIMIT_MSG,
          });

        try {
          const supabase = getSupabaseAdmin();
          const { data: rows, error } = await withTimeout(
            supabase
              .from("users")
              .select("*")
              .eq("email", input.email)
              .limit(1)
              .maybeSingle(),
            REST_TIMEOUT_MS,
            "forgot lookup"
          );
          if (error) throw error;
          const u: any = rows;
          if (u) {
            const token = await createResetToken(u.id, u.openId);
            const hashed = hashToken(token);
            const expiresAt = new Date(
              Date.now() + 60 * 60 * 1000
            ).toISOString();
            const supabaseTyped = getSupabaseAdmin() as any;
            // Single-use, short-lived, stored hashed.
            await supabaseTyped.from("password_resets").insert({
              user_id: u.id,
              token_hash: hashed,
              purpose: "reset",
              used: false,
              expires_at: expiresAt,
            });
            // Legacy columns kept in sync for older in-flight links.
            await supabaseTyped
              .from("users")
              .update({
                passwordResetToken: hashed,
                passwordResetExpires: expiresAt,
              } as any)
              .eq("id", u.id);
            try {
              await recordAudit({
                actorUserId: u.id,
                entityType: "auth",
                action: "password_reset_requested",
                success: true,
                ip,
                userAgent: (ctx.req.headers["user-agent"] as string) ?? null,
              });
            } catch {}
            await sendPasswordResetEmail(input.email, token).catch(() => {});
            if (
              process.env.DEBUG_AUTH_TOKENS === "1" &&
              process.env.NODE_ENV !== "production"
            ) {
              console.log(
                `[auth] Password reset token for ${input.email}: ${token}`
              );
            }
          }
        } catch (e) {
          if (e instanceof TRPCError) throw e;
        }
        // Identical response whether or not the account exists.
        return {
          success: true,
          message:
            "If an account exists for this email, password reset instructions have been sent.",
        } as const;
      }),

    resetPassword: publicProcedure
      .input(
        z.object({
          token: z.string().min(10).max(2000),
          password: passwordSchema,
          confirmPassword: passwordSchema,
        })
      )
      .mutation(async ({ input }) => {
        if (input.password !== input.confirmPassword) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Passwords do not match.",
          });
        }
        const policy = checkPasswordPolicy(input.password);
        if (!policy.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: policy.reason });
        }
        const payload = await verifyResetToken(input.token);
        if (!payload)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid or expired reset token.",
          });

        let dbUser: any = null;
        try {
          const supabase = getSupabaseAdmin();
          const { data, error } = await withTimeout(
            supabase
              .from("users")
              .select("*")
              .eq("openId", payload.openId)
              .limit(1)
              .maybeSingle(),
            REST_TIMEOUT_MS,
            "reset lookup"
          );
          if (error) throw error;
          dbUser = data;
        } catch {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Unable to reset password. Please try again.",
            cause: { expose: true },
          });
        }
        if (!dbUser)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid or expired reset token.",
          });

        // The token must be present AND unused AND unexpired in
        // `password_resets`. The previous code fell back to comparing the
        // legacy `users.passwordResetToken` column with no `used` check and
        // skipped the expiry test when the column was null, which defeated
        // single-use. Consume the row atomically so two concurrent redemptions
        // cannot both win.
        const hashedInput = hashToken(input.token);
        const supabaseAny = getSupabaseAdmin() as any;
        let consumedId: number | null = null;
        try {
          const { data: claimed, error: claimErr } = await supabaseAny
            .from("password_resets")
            .update({ used: true, used_at: new Date().toISOString() })
            .eq("user_id", dbUser.id)
            .eq("token_hash", hashedInput)
            .eq("used", false)
            .gt("expires_at", new Date().toISOString())
            .select("id");
          if (claimErr) throw claimErr;
          if (Array.isArray(claimed) && claimed.length)
            consumedId = Number(claimed[0].id);
        } catch {
          consumedId = null;
        }
        if (consumedId == null) {
          // SQL fallback with the same atomic claim semantics.
          try {
            const sql = await getSql();
            const rows: any[] = await sql.unsafe(
              `UPDATE password_resets SET used = true, used_at = now()
                 WHERE user_id = $1 AND token_hash = $2 AND used = false AND expires_at > now()
                 RETURNING id`,
              [dbUser.id, hashedInput]
            );
            if (rows[0]) consumedId = Number(rows[0].id);
          } catch {}
        }
        if (consumedId == null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid or expired reset token.",
          });
        }

        const newHash = await hashPassword(input.password);
        await updateUserById(dbUser.id, {
          passwordHash: newHash,
          password_alg: "argon2id",
          password_updated_at: new Date().toISOString(),
          passwordResetToken: null,
          passwordResetExpires: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
          sessionVersion: (dbUser.sessionVersion ?? 0) + 1,
        });

        // Every existing session dies, including any "remembered" devices.
        await revokeAllSessionsForUser(dbUser.id, "password_reset");
        invalidateSessionCache();

        try {
          await recordAudit({
            actorUserId: dbUser.id,
            entityType: "auth",
            action: "password_reset",
            success: true,
            after: { resetId: consumedId },
          });
        } catch {}

        return { success: true } as const;
      }),

    // ── Change password ────────────────────────────────────────────────────
    // Protected AND gated on a recent password check. Remembered sessions get
    // no bypass: either the session was re-authenticated within
    // AUTH_REAUTH_WINDOW_MIN, or the current password is supplied here.
    changePassword: protectedProcedure
      .input(
        z.object({
          currentPassword: loginPasswordSchema,
          newPassword: passwordSchema,
          confirmPassword: passwordSchema,
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (input.newPassword !== input.confirmPassword) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Passwords do not match.",
          });
        }
        if (input.newPassword === input.currentPassword) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "New password must be different from current password.",
          });
        }
        const policy = checkPasswordPolicy(input.newPassword);
        if (!policy.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: policy.reason });
        }

        const supabase = getSupabaseAdmin();
        const { data: u, error } = await withTimeout(
          supabase
            .from("users")
            .select("*")
            .eq("id", ctx.user.id)
            .limit(1)
            .maybeSingle(),
          REST_TIMEOUT_MS,
          "change-password lookup"
        );
        if (error || !u)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Password change not available for this account.",
          });
        const user: any = u;
        if (!user.passwordHash)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Password change not available for this account.",
          });

        // A remembered device that has not recently proven the password must
        // re-enter it, even though it holds a valid, unexpired session.
        const recentlyAuthed = isRecentlyReauthenticated(
          (ctx.user as any)?.authPayload ?? null
        );
        if (!recentlyAuthed) {
          if (!input.currentPassword) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: REAUTH_ERR_MSG,
            });
          }
          const valid = await verifyPassword(
            input.currentPassword,
            user.passwordHash
          );
          if (!valid) {
            try {
              await recordAudit({
                actorUserId: ctx.user.id,
                entityType: "auth",
                action: "password_change_denied",
                success: false,
                ip: getClientIp(ctx.req as any),
                after: { reason: "stale_reauth" },
              });
            } catch {}
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: REAUTH_ERR_MSG,
            });
          }
        }

        const curVer = (user.sessionVersion ?? 0) as number;
        const newHash = await hashPassword(input.newPassword);
        await updateUserById(ctx.user.id, {
          passwordHash: newHash,
          password_alg: "argon2id",
          password_updated_at: new Date().toISOString(),
          sessionVersion: curVer + 1,
        });

        // Kill every session on every device, then mint a fresh one for the
        // current device so the user is not signed out of the tab they are on.
        await revokeAllSessionsForUser(ctx.user.id, "password_changed");
        invalidateSessionCache();
        const newRefresh = createRefreshToken();
        const session = await createSession({
          userId: ctx.user.id,
          audience: "admin",
          refreshToken: newRefresh,
          familyId: createFamilyId(),
          remember: (ctx.user as any)?.remember === true,
          userAgent: (ctx.req.headers["user-agent"] as string) ?? null,
          ipAddress:
            getClientIp(ctx.req as any) === "unknown"
              ? null
              : getClientIp(ctx.req as any),
          sessionVersion: curVer + 1,
        });
        const remember = (ctx.user as any)?.remember === true;
        const token = await createSessionToken({
          uid: ctx.user.id,
          openId: user.openId,
          role: user.role,
          sv: curVer + 1,
          aud: "admin",
          sid: session.id,
          rem: remember,
          rat: Math.floor(Date.now() / 1000),
        } as any);
        const lifetimeSec = getAbsoluteLifetimeSec(remember);
        if (ctx.res.cookie) {
          ctx.res.cookie(
            getSessionCookieName(),
            token,
            getSessionCookieOptions({ remember, maxAgeSec: lifetimeSec })
          );
          ctx.res.cookie(
            getRefreshCookieName(),
            newRefresh,
            getRefreshCookieOptions({ remember, maxAgeSec: lifetimeSec })
          );
        }

        try {
          await recordAudit({
            actorUserId: ctx.user.id,
            entityType: "auth",
            action: "password_changed",
            success: true,
            ip: getClientIp(ctx.req as any),
            userAgent: (ctx.req.headers["user-agent"] as string) ?? null,
            after: { revokedOthers: true },
          });
        } catch {}

        return { success: true } as const;
      }),
  }),
  public: publicRouter,
  admin: adminRouter,
  inventory: inventoryRouter,
  analytics: analyticsRouter,
  loyalty: loyaltyRouter,
  notifications: notificationsRouter,
  search: searchRouter,
  settings: settingsRouter,
  shifts: shiftsRouter,
  staff: staffWorkforceRouter,
  outlets: outletsRouter,
  delivery: deliveryRouter,
  customers: customersRouter,
  marketing: marketingRouter,
  coupons: couponsRouter,
  finance: financeRouter,
  content: contentRouter,
  instagram: instagramRouter,
  support: supportRouter,
  audit: auditRouter,
});

export type AppRouter = typeof appRouter;

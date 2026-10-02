import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { AUTH_REQUIRED_MSG } from "@shared/const";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // Never leak internal/database error strings to clients. Procedures that
    // intentionally surface an INTERNAL_SERVER_ERROR message (e.g. infra
    // "auth temporarily unavailable") opt in with `cause: { expose: true }`.
    const exposed = Boolean(
      (error.cause as { expose?: boolean } | undefined)?.expose
    );
    // tRPC populates `data.stack` on every error when NODE_ENV !== production.
    // Scrubbing only the message left the full stack in the response body
    // (observed live: a failed login returned internal file paths and line
    // numbers). Strip it unconditionally — clients have no use for it, and in
    // production a misconfigured NODE_ENV would otherwise leak it.
    const sanitized: typeof shape = { ...shape };
    if (sanitized.data && typeof sanitized.data === "object") {
      const { stack: _stack, ...rest } = sanitized.data as Record<
        string,
        unknown
      >;
      sanitized.data = rest as typeof sanitized.data;
    }
    // Publish the caller's domain code alongside the generic tRPC code.
    //
    // `TRPCError.cause` is not serialised by default, so `throw new TRPCError({
    // cause: { domainCode } })` would be invisible to starkupps-web. Promote it
    // explicitly: clients classify on this instead of regex-matching English
    // prose, which is what made "Delivery not available at this outlet." get
    // reported to customers as "Some items are unavailable at this outlet.".
    const domainCode = (error.cause as { domainCode?: unknown } | undefined)
      ?.domainCode;
    if (typeof domainCode === "string" && sanitized.data) {
      // `DefaultErrorData` has no index signature, so extending it needs a cast.
      sanitized.data = {
        ...sanitized.data,
        domainCode,
      } as typeof sanitized.data;
    }
    if (error.code === "INTERNAL_SERVER_ERROR" && !exposed) {
      return {
        ...sanitized,
        message: "Something went wrong on our side. Please try again.",
      };
    }
    return sanitized;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
// Admin-panel boundary: requires an authenticated user with an admin-audience
// session. POS-audience tokens are rejected with FORBIDDEN (authenticated but
// not authorized for Admin) so callers can distinguish from UNAUTHORIZED.
// Legacy tokens without aud remain accepted for backward compatibility and
// for direct tRPC caller tests that construct ctx manually.
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: AUTH_REQUIRED_MSG });
  }
  const aud = (ctx as unknown as { aud?: string | null }).aud;
  if (aud === "pos") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "POS session cannot access Admin resources. Please sign in to the Admin panel.",
    });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
// Explicit admin-audience procedures use protectedProcedure directly.
export const createCallerFactory = t.createCallerFactory;

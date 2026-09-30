import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import { COOKIE_NAME } from "../../shared/const";
import type { TrpcContext } from "../lib/context";

type CookieCall = {
  name: string;
  options: Record<string, unknown>;
};

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): {
  ctx: TrpcContext;
  clearedCookies: CookieCall[];
} {
  const clearedCookies: CookieCall[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "local",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    aud: "admin",
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

describe("auth.logout", () => {
  it("clears both auth cookies and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    // Access + refresh + CSRF, so no credential or token survives logout.
    expect(clearedCookies).toHaveLength(3);

    const access = clearedCookies.find(c => c.name === COOKIE_NAME);
    expect(access).toBeDefined();
    // `maxAge` is deliberately omitted: Express expires cleared cookies itself
    // and ignores options.maxAge from v5.
    expect(access?.options).toMatchObject({
      httpOnly: true,
      path: "/",
      // SameSite is no longer upgraded to `none` from a client-supplied
      // X-Forwarded-Proto header; Lax is unconditional (see auth/cookies.ts).
      sameSite: "lax",
    });
    expect(access?.options.maxAge).toBeUndefined();

    const refresh = clearedCookies.find(c => c.name.includes("refresh"));
    expect(refresh).toBeDefined();
    expect(refresh?.options).toMatchObject({
      httpOnly: true,
      // Scoped to the API surface rather than the whole origin.
      path: "/api",
      sameSite: "lax",
    });

    // The CSRF double-submit cookie must be cleared too, or it outlives the
    // session it was issued for.
    expect(clearedCookies.some(c => c.name.includes("csrf"))).toBe(true);
  });
});

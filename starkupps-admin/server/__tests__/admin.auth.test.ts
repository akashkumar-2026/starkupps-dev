import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import { AUTH_REQUIRED_MSG } from "@shared/const";
import type { TrpcContext } from "../lib/context";

function createAnonymousContext(): TrpcContext {
  return {
    aud: null,
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("StarKupps operational access", () => {
  it("rejects an anonymous order-queue request before reaching the database", async () => {
    const caller = appRouter.createCaller(createAnonymousContext());
    await expect(caller.admin.orders.list({ limit: 25 })).rejects.toMatchObject(
      {
        code: "UNAUTHORIZED",
        message: AUTH_REQUIRED_MSG,
      }
    );
  });

  it("rejects an anonymous settings request before reaching the database", async () => {
    const caller = appRouter.createCaller(createAnonymousContext());
    await expect(caller.settings.get()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: AUTH_REQUIRED_MSG,
    });
  });
});

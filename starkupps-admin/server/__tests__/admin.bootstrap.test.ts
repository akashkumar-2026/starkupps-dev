import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../lib/context";

function createOwnerContext(): TrpcContext {
  return {
    aud: "admin",
    user: {
      id: 1,
      openId: "test-owner",
      name: "Test Owner",
      email: "owner@example.com",
      loginMethod: "local",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("StarKupps persistent bootstrap", () => {
  it("reads the empty operational workspace without fabricating records", async () => {
    const caller = appRouter.createCaller(createOwnerContext());
    const result = await caller.admin.bootstrap();

    expect(result.staffRole).toBe("owner");
    expect(result.activeShift).toBeNull();
    expect(result.settings).toBeNull();
  });
});

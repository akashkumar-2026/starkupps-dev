import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import { AUTH_REQUIRED_MSG } from "@shared/const";
import type { TrpcContext } from "../lib/context";

function anonymous(): TrpcContext {
  return {
    aud: null,
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("Inventory access boundary", () => {
  it("rejects anonymous inventory queries before they can load operational stock data", async () => {
    const caller = appRouter.createCaller(anonymous());
    await expect(caller.inventory.dashboard()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: AUTH_REQUIRED_MSG,
    });
    await expect(caller.inventory.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: AUTH_REQUIRED_MSG,
    });
    await expect(caller.inventory.transactions()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: AUTH_REQUIRED_MSG,
    });
  });

  it("rejects anonymous inventory mutations before they can alter stock", async () => {
    const caller = appRouter.createCaller(anonymous());
    await expect(
      caller.inventory.adjust({
        itemId: 1,
        type: "waste",
        quantity: 1,
        reason: "Spoilage observed",
        notes: null,
        batchId: null,
      })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: AUTH_REQUIRED_MSG,
    });
  });
});

import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, roleCan } from "@shared/permissions";
import { appRouter } from "../routers";
import type { TrpcContext } from "../lib/context";
import { sanitizeReturnTo } from "../auth/auth";
import { escapePostgrestOr } from "../db/index";

function createContext(aud: "admin" | "pos"): TrpcContext {
  return {
    aud,
    user: {
      id: 2,
      openId: "test-user",
      name: "Test User",
      email: "user@example.com",
      loginMethod: "local",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("role permission matrix", () => {
  it("grants owners every permission defined for the panel", () => {
    const owner = new Set(ROLE_PERMISSIONS.owner);
    for (const perm of Object.values(ROLE_PERMISSIONS).flat()) {
      expect(owner.has(perm)).toBe(true);
    }
  });

  it("withholds owner-only destructive permissions from managers", () => {
    expect(roleCan("manager", "staff.create")).toBe(false);
    expect(roleCan("manager", "coupons.delete")).toBe(false);
    expect(roleCan("manager", "finance.refund")).toBe(false);
    expect(roleCan("manager", "settings.update")).toBe(false);
  });

  it("restricts staff to operational capabilities", () => {
    expect(roleCan("staff", "orders.update")).toBe(true);
    expect(roleCan("staff", "orders.cancel")).toBe(false);
    expect(roleCan("staff", "menu.create")).toBe(false);
    expect(roleCan("staff", "staff.read")).toBe(false);
    expect(roleCan("staff", "audit.read")).toBe(false);
  });

  it("denies unknown roles", () => {
    expect(roleCan(null, "orders.read")).toBe(false);
  });
});

describe("panel audience isolation", () => {
  it("rejects a POS-audience session on an Admin procedure with FORBIDDEN", async () => {
    const caller = appRouter.createCaller(createContext("pos"));
    await expect(caller.admin.orders.list({ limit: 25 })).rejects.toMatchObject(
      { code: "FORBIDDEN" }
    );
  });

  it("rejects a POS-audience session on owner settings with FORBIDDEN", async () => {
    const caller = appRouter.createCaller(createContext("pos"));
    await expect(caller.settings.get()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("returnTo sanitization (open-redirect guard)", () => {
  it("accepts relative paths", () => {
    expect(sanitizeReturnTo("/orders?status=new")).toBe("/orders?status=new");
  });

  it("rejects protocol-relative, absolute and encoded redirects", () => {
    expect(sanitizeReturnTo("//evil.com")).toBeNull();
    expect(sanitizeReturnTo("https://evil.com")).toBeNull();
    expect(sanitizeReturnTo("/%2F%2Fevil.com")).toBeNull();
    expect(sanitizeReturnTo("/auth/login")).toBeNull();
  });
});

describe("PostgREST filter escaping", () => {
  it("escapes grammar-significant characters", () => {
    const escaped = escapePostgrestOr('a,b(c)"d%');
    expect(escaped).toContain("\\,");
    expect(escaped).toContain("\\(");
    expect(escaped).toContain("\\)");
    expect(escaped).toContain('\\"');
    expect(escaped).toContain("\\%");
  });
});

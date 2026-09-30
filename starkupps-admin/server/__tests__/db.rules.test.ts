import { describe, expect, it } from "vitest";
import { calculateOrderTotal, escapePostgrestOr, roleCan } from "../db/index";

describe("calculateOrderTotal (canonical pricing)", () => {
  it("sums lines and applies a percentage discount, tax and charges", () => {
    const r = calculateOrderTotal({
      lines: [{ quantity: 2, unitPrice: 100 }],
      discount: { type: "percentage", value: 10 },
      taxes: [{ rate: 5, enabled: true }],
      charges: { service: 10, packaging: 5, delivery: 0 },
    });
    expect(r.subtotal).toBe(200);
    expect(r.discountAmount).toBe(20);
    expect(r.taxable).toBe(180);
    expect(r.taxTotal).toBeCloseTo(9, 6);
    expect(r.chargesTotal).toBe(15);
    expect(r.total).toBeCloseTo(204, 6);
  });

  it("includes modifier totals in the line subtotal", () => {
    const r = calculateOrderTotal({
      lines: [{ quantity: 1, unitPrice: 100, modifiersTotal: 15 }],
    });
    expect(r.subtotal).toBe(115);
    expect(r.total).toBe(115);
  });

  it("caps a percentage discount at maxDiscount", () => {
    const r = calculateOrderTotal({
      lines: [{ quantity: 1, unitPrice: 1000 }],
      discount: { type: "percentage", value: 50, maxDiscount: 100 },
    });
    expect(r.discountAmount).toBe(100);
    expect(r.total).toBe(900);
  });

  it("clamps a fixed discount to the subtotal", () => {
    const r = calculateOrderTotal({
      lines: [{ quantity: 1, unitPrice: 50 }],
      discount: { type: "fixed", value: 80 },
    });
    expect(r.discountAmount).toBe(50);
    expect(r.total).toBe(0);
  });

  it("ignores disabled taxes", () => {
    const r = calculateOrderTotal({
      lines: [{ quantity: 1, unitPrice: 100 }],
      taxes: [{ rate: 18, enabled: false }],
    });
    expect(r.taxTotal).toBe(0);
    expect(r.total).toBe(100);
  });
});

describe("roleCan legacy capability mapping", () => {
  it("maps legacy area names to the role permission matrix", () => {
    expect(roleCan("owner", "orders")).toBe(true);
    expect(roleCan("owner", "settings")).toBe(true);
    expect(roleCan("manager", "analytics")).toBe(true);
    expect(roleCan("staff", "orders")).toBe(true);
    expect(roleCan("staff", "settings")).toBe(false);
  });

  it("still enforces granular permissions", () => {
    expect(roleCan("owner", "finance.refund")).toBe(true);
    expect(roleCan("staff", "finance.refund")).toBe(false);
  });
});

describe("escapePostgrestOr", () => {
  it("escapes backslash, percent, comma, parentheses and quote", () => {
    const escaped = escapePostgrestOr('a,b(c)"d%\\');
    expect(escaped).toContain("\\,");
    expect(escaped).toContain("\\%");
    expect(escaped).toContain("\\(");
    expect(escaped).toContain("\\)");
    expect(escaped).toContain('\\"');
    expect(escaped).toContain("\\\\");
  });
});

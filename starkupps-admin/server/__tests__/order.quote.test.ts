import { describe, expect, it } from "vitest";
import { computeOrderQuote } from "../routers/publicRouter";
import { createTrackToken, verifyTrackToken } from "../auth/auth";

describe("order charge quote", () => {
  const base = {
    type: "takeaway" as const,
    taxable: 200,
    packingCharge: 15,
    deliveryFee: 29,
    freeDeliveryAbove: null,
    taxRates: [],
  };

  it("applies packing for takeaway, no delivery, no tax by default", () => {
    const q = computeOrderQuote(base);
    expect(q).toMatchObject({
      packing: 15,
      delivery: 0,
      tax: 0,
      chargesTotal: 15,
      total: 215,
    });
  });

  it("applies delivery fee for delivery orders only", () => {
    const q = computeOrderQuote({ ...base, type: "delivery" });
    expect(q).toMatchObject({
      packing: 15,
      delivery: 29,
      chargesTotal: 44,
      total: 244,
    });
  });

  it("charges nothing extra for dine-in", () => {
    const q = computeOrderQuote({ ...base, type: "dine_in" });
    expect(q).toMatchObject({
      packing: 0,
      delivery: 0,
      chargesTotal: 0,
      total: 200,
    });
  });

  it("honours free-delivery coupon and threshold", () => {
    expect(
      computeOrderQuote({ ...base, type: "delivery", freeDelivery: true })
        .delivery
    ).toBe(0);
    expect(
      computeOrderQuote({ ...base, type: "delivery", freeDeliveryAbove: 199 })
        .delivery
    ).toBe(0);
    expect(
      computeOrderQuote({ ...base, type: "delivery", freeDeliveryAbove: 201 })
        .delivery
    ).toBe(29);
  });

  it("applies configured tax rates on the taxable amount with line items", () => {
    const q = computeOrderQuote({
      ...base,
      type: "delivery",
      taxRates: [
        { name: "CGST", rate: 2.5 },
        { name: "SGST", rate: 2.5 },
      ],
    });
    expect(q.taxLines).toEqual([
      { name: "CGST", rate: 2.5, amount: 5 },
      { name: "SGST", rate: 2.5, amount: 5 },
    ]);
    expect(q.tax).toBe(10);
    expect(q.total).toBe(254);
  });

  it("rounds to paise and never goes negative", () => {
    const q = computeOrderQuote({
      ...base,
      taxable: -5,
      packingCharge: 14.995,
    });
    expect(q.total).toBe(15);
  });
});

describe("order tracking token", () => {
  it("round-trips an order id and rejects tampered tokens", async () => {
    const token = await createTrackToken(1234);
    await expect(verifyTrackToken(token)).resolves.toEqual({ orderId: 1234 });
    await expect(verifyTrackToken(`${token}x`)).resolves.toBeNull();
    await expect(verifyTrackToken("not-a-token")).resolves.toBeNull();
  });
});

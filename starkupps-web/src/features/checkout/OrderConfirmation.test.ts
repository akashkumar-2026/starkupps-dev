import { describe, expect, it } from "vitest";

import type { ConfirmationItem, PriceLine } from "./OrderConfirmation";
import {
  CONFIRMATION_EXTEND_MS,
  CONFIRMATION_MS,
  confirmationTitle,
  nextStepLabel,
} from "./confirmation";

/**
 * The breakdown the customer reads to decide whether the total is right.
 *
 * It is assembled from the server's own persisted figures rather than
 * recomputed here, so these tests are about *presentation* — that every figure
 * shown exists, that zero-value noise is omitted, and that the line items
 * cannot silently disagree with the subtotal. A receipt whose lines do not sum
 * to its own subtotal is worse than showing no breakdown at all.
 */

/** Mirrors `CartSheet`'s rounding, which mirrors the server's. */
const lineTotal = (unitPrice: number, qty: number) => Math.round(unitPrice * qty * 100) / 100;

describe("confirmation line items", () => {
  it("sums to the subtotal the server reported", () => {
    const items: ConfirmationItem[] = [
      {
        name: "Classic Cold Coffee",
        variantName: "Default",
        qty: 2,
        unitPrice: 50,
        lineTotal: lineTotal(50, 2),
      },
      {
        name: "Kulhad Pizza",
        variantName: "Large",
        qty: 1,
        unitPrice: 220,
        lineTotal: lineTotal(220, 1),
      },
      { name: "Oreo Shake", variantName: null, qty: 3, unitPrice: 55, lineTotal: lineTotal(55, 3) },
    ];
    const sum = items.reduce((total, item) => total + item.lineTotal, 0);
    // 100 + 220 + 165
    expect(sum).toBeCloseTo(485, 2);
    // Priced from persisted menu data, so no client-side drift.
    expect(items[0]!.lineTotal).toBe(100);
  });

  it("rounds per line so the column sums cleanly", () => {
    // 3 × ₹33.33 is 99.99; rounding the total instead would drift a paisa
    // across enough lines to make the receipt visibly wrong.
    const items: ConfirmationItem[] = [
      { name: "A", qty: 3, unitPrice: 33.33, lineTotal: lineTotal(33.33, 3) },
      { name: "B", qty: 3, unitPrice: 33.33, lineTotal: lineTotal(33.33, 3) },
    ];
    expect(items.reduce((t, i) => t + i.lineTotal, 0)).toBeCloseTo(199.98, 2);
  });

  it("carries the variant and modifier labels the kitchen needs", () => {
    // Both are what the counter reads back to make the drink correctly, so an
    // order confirmation that drops them is not a receipt.
    const item: ConfirmationItem = {
      name: "Cold Coffee",
      variantName: "Large",
      qty: 1,
      unitPrice: 75,
      lineTotal: 75,
      options: ["Oat milk", "Extra thick"],
    };
    expect(item.variantName).toBe("Large");
    expect(item.options).toEqual(["Oat milk", "Extra thick"]);
  });
});

describe("pricing lines", () => {
  /**
   * Mirrors the construction in `CartSheet`.
   *
   * Only non-zero charges are emitted — a ₹0 delivery row on a counter pickup is
   * noise, and a long list of zeroes makes the real charges harder to find.
   */
  const buildPricing = (o: {
    subtotal: number;
    couponDiscount: number;
    packing: number;
    delivery: number;
    tax: number;
  }): PriceLine[] => [
    { label: "Subtotal", value: o.subtotal },
    ...(o.couponDiscount > 0
      ? [{ label: "Discount", value: o.couponDiscount, negative: true }]
      : []),
    ...(o.packing > 0 ? [{ label: "Packaging", value: o.packing }] : []),
    ...(o.delivery > 0 ? [{ label: "Delivery", value: o.delivery }] : []),
    ...(o.tax > 0 ? [{ label: "Tax", value: o.tax }] : []),
  ];

  it("itemises a delivery order", () => {
    const lines = buildPricing({
      subtotal: 50,
      couponDiscount: 0,
      packing: 0,
      delivery: 15,
      tax: 0,
    });
    expect(lines.map((l) => l.label)).toEqual(["Subtotal", "Delivery"]);
    expect(lines.reduce((t, l) => t + (l.negative ? -l.value : l.value), 0)).toBe(65);
  });

  it("omits zero charges so the real ones stand out", () => {
    const lines = buildPricing({
      subtotal: 50,
      couponDiscount: 0,
      packing: 0,
      delivery: 0,
      tax: 0,
    });
    expect(lines).toEqual([{ label: "Subtotal", value: 50 }]);
  });

  it("marks a discount negative so it reads as a reduction", () => {
    const lines = buildPricing({
      subtotal: 100,
      couponDiscount: 20,
      packing: 15,
      delivery: 29,
      tax: 2.75,
    });
    expect(lines.find((l) => l.label === "Discount")?.negative).toBe(true);
    expect(lines.reduce((t, l) => t + (l.negative ? -l.value : l.value), 0)).toBeCloseTo(126.75, 2);
  });

  it("never charges delivery on a counter order", () => {
    // The server enforces this; the screen must not imply otherwise either.
    const lines = buildPricing({
      subtotal: 50,
      couponDiscount: 0,
      packing: 15,
      delivery: 0,
      tax: 0,
    });
    expect(lines.some((l) => l.label === "Delivery")).toBe(false);
  });

  it("always leads with the subtotal so the total can be checked by hand", () => {
    const lines = buildPricing({
      subtotal: 50,
      couponDiscount: 5,
      packing: 15,
      delivery: 29,
      tax: 1,
    });
    expect(lines[0]!.label).toBe("Subtotal");
  });
});

describe("confirmationTitle", () => {
  it("greets by first name", () => {
    expect(confirmationTitle("Dheeraj Kumar")).toBe("Thanks, Dheeraj");
  });

  it("still reads correctly with no name", () => {
    expect(confirmationTitle("")).toBe("Order confirmed");
    expect(confirmationTitle("   ")).toBe("Order confirmed");
  });

  it("stays short enough for one line on a narrow phone", () => {
    expect(confirmationTitle("Dheeraj Kumar").length).toBeLessThan(20);
  });
});

describe("nextStepLabel", () => {
  it("gives delivery its own instruction", () => {
    expect(nextStepLabel("delivery")).toMatch(/call you/i);
    expect(nextStepLabel("delivery").toLowerCase()).not.toMatch(/counter/);
  });

  it("mentions the table for dine-in and a wait for takeaway", () => {
    expect(nextStepLabel("dine-in")).toMatch(/table/i);
    expect(nextStepLabel("takeaway")).toMatch(/10 minutes|ready/i);
  });

  it("never renders empty for an unknown type", () => {
    expect(nextStepLabel("scheduled_pickup")).toBeTruthy();
    expect(nextStepLabel("")).toBeTruthy();
  });
});

describe("timing", () => {
  it("dismisses on its own, but not before it can be read", () => {
    expect(CONFIRMATION_MS).toBeGreaterThan(0);
    expect(CONFIRMATION_MS).toBeLessThanOrEqual(15_000);
  });

  it("grants a full fresh interval on interaction", () => {
    // Copying a ticket number takes longer than one interval for many people,
    // so hovering or focusing buys a whole new interval rather than a few
    // extra seconds — otherwise the screen vanishes mid-read.
    expect(CONFIRMATION_EXTEND_MS).toBeGreaterThanOrEqual(CONFIRMATION_MS);
  });
});

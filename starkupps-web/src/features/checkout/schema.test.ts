import { describe, expect, it } from "vitest";

import {
  checkoutDefaults,
  getCheckoutSchema,
  parseCheckout,
  type CheckoutFormValues,
} from "./schema";

const validBase = { name: "Aman Kumar", phone: "9876543210", notes: "" };

function input(overrides: Partial<CheckoutFormValues> = {}): CheckoutFormValues {
  return { ...checkoutDefaults.takeaway, ...validBase, ...overrides } as CheckoutFormValues;
}

describe("checkout validation", () => {
  it("normalises a valid takeaway order", () => {
    const parsed = parseCheckout(input({ name: "  Aman   Kumar  ", phone: "9876543210" }));
    expect(parsed.name).toBe("Aman Kumar");
    expect(parsed.phoneNormalized).toBe("9876543210");
  });

  it("strips formatting from the phone number", () => {
    const parsed = parseCheckout(input({ phone: "98765 43210" } as Partial<CheckoutFormValues>));
    expect(parsed.phoneNormalized).toBe("9876543210");
  });

  it("rejects a phone number carrying a country code", () => {
    const result = getCheckoutSchema("takeaway").safeParse(input({ phone: "+91 98765 43210" }));
    expect(result.success).toBe(false);
  });

  it("requires a full address for delivery", () => {
    const result = getCheckoutSchema("delivery").safeParse(
      input({ orderType: "delivery", address: "" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a one-word address even for delivery", () => {
    const result = getCheckoutSchema("delivery").safeParse(
      input({ orderType: "delivery", address: "Munger" }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts a delivery order with a full address", () => {
    const result = getCheckoutSchema("delivery").safeParse(
      input({ orderType: "delivery", address: "12 Station Road, Munger" }),
    );
    expect(result.success).toBe(true);
  });

  it("does not require an address for dine-in or takeaway", () => {
    for (const orderType of ["dine-in", "takeaway"] as const) {
      expect(getCheckoutSchema(orderType).safeParse(input({ orderType })).success).toBe(true);
    }
  });

  it("rejects phone numbers that are not Indian mobiles", () => {
    for (const phone of ["1234567890", "12345", "98765432101234"]) {
      const result = getCheckoutSchema("takeaway").safeParse(input({ phone }));
      expect(result.success, `expected ${phone} to be rejected`).toBe(false);
    }
  });

  it("rejects names containing digits", () => {
    const result = getCheckoutSchema("takeaway").safeParse(input({ name: "Aman2 Kumar" }));
    expect(result.success).toBe(false);
  });

  it("collapses whitespace in notes", () => {
    const parsed = parseCheckout(input({ notes: "extra   cheese   please" }));
    expect(parsed.notes).toBe("extra cheese please");
  });

  it("treats an omitted notes field as empty", () => {
    const parsed = parseCheckout(input({ notes: undefined } as Partial<CheckoutFormValues>));
    expect(parsed.notes).toBe("");
  });
});

import { describe, expect, it } from "vitest";

import { OrderDomainCode } from "@/config/order-error-codes";
import { ApiError } from "@/api/client";
import { TrpcError } from "./trpc-error";
import { classifyOrderError, orderErrorDetail } from "./order-errors";

/** Mirrors what the gateway sends: an `ApiError` carrying a domain code. */
function apiError(message: string, domainCode?: OrderDomainCode) {
  return new TrpcError(message, 400, "public.orders.create", domainCode);
}

describe("classifyOrderError — by domain code", () => {
  it("does not blame the menu when delivery is not offered", () => {
    // The exact regression: this message used to be reported as
    // "Some items are unavailable at this outlet."
    const failure = classifyOrderError(
      apiError("Delivery not available at this outlet.", OrderDomainCode.ORDER_TYPE_UNAVAILABLE),
    );
    expect(failure.kind).toBe("order_type_unavailable");
    expect(failure.title).not.toMatch(/items are unavailable/i);
    expect(failure.affectsCart).toBe(false);
  });

  it("separates the three order-type rejections from item problems", () => {
    for (const message of [
      "Delivery not available at this outlet.",
      "Takeaway not available at this outlet.",
      "Dine-in not available at this outlet.",
    ]) {
      expect(
        classifyOrderError(apiError(message, OrderDomainCode.ORDER_TYPE_UNAVAILABLE)).kind,
      ).toBe("order_type_unavailable");
    }
  });

  it("still blames the menu for a genuinely unavailable item", () => {
    const failure = classifyOrderError(
      apiError("Kulhad Pizza is not available at this outlet.", OrderDomainCode.ITEM_UNAVAILABLE),
    );
    expect(failure.kind).toBe("item_unavailable");
    expect(failure.title).toMatch(/unavailable/i);
    expect(failure.affectsCart).toBe(true);
  });

  it("distinguishes coming soon from unavailable", () => {
    expect(
      classifyOrderError(apiError("Kulhad Pizza is COMING SOON.", OrderDomainCode.ITEM_COMING_SOON))
        .kind,
    ).toBe("coming_soon");
  });

  it("distinguishes all-disabled from one-disabled", () => {
    // Telling a customer to "pick another option" when every method is off
    // sends them to pick one that is equally unavailable.
    const allOff = classifyOrderError(
      apiError(
        "This outlet is not accepting orders online at the moment.",
        OrderDomainCode.NO_ORDER_TYPES_AVAILABLE,
      ),
    );
    expect(allOff.kind).toBe("no_order_types_available");
    expect(allOff.hint).toMatch(/different outlet/i);
    expect(allOff.hint).not.toMatch(/another option/i);
  });

  it("reports a website-orders kill switch without telling them to try another type", () => {
    const paused = classifyOrderError(
      apiError(
        "This outlet is not accepting online orders right now.",
        OrderDomainCode.OUTLET_NOT_ACCEPTING_ORDERS,
      ),
    );
    expect(paused.kind).toBe("outlet_unavailable");
    expect(paused.hint).toMatch(/in person/i);
  });

  it("maps a closed outlet to its own kind", () => {
    expect(
      classifyOrderError(
        apiError(
          "Selected outlet is not accepting orders right now.",
          OrderDomainCode.OUTLET_UNAVAILABLE,
        ),
      ).kind,
    ).toBe("outlet_unavailable");
  });

  it("maps every documented code without falling through to unknown", () => {
    const codes = Object.values(OrderDomainCode);
    for (const code of codes) {
      expect(classifyOrderError(apiError("whatever", code)).kind).not.toBe("unknown");
    }
  });
});

describe("classifyOrderError — message fallback for an older gateway", () => {
  // Without a domain code the classifier must still not repeat the original bug.
  it("does not report an order-type rejection as an item problem", () => {
    for (const message of [
      "Delivery not available at this outlet.",
      "Takeaway not available at this outlet.",
      "Dine-in not available at this outlet.",
    ]) {
      const failure = classifyOrderError(apiError(message));
      expect(failure.kind).toBe("order_type_unavailable");
      expect(failure.title).not.toMatch(/items are unavailable/i);
    }
  });

  it("still routes a real item rejection to the item message", () => {
    expect(classifyOrderError(apiError("Kulhad Pizza is not available at this outlet.")).kind).toBe(
      "item_unavailable",
    );
  });

  it("prefers the coming-soon branch", () => {
    expect(
      classifyOrderError(apiError("Kulhad Pizza is COMING SOON and cannot be ordered yet.")).kind,
    ).toBe("coming_soon");
  });

  it("handles coupon and minimum-order messages", () => {
    expect(classifyOrderError(apiError("Coupon not found.")).kind).toBe("coupon_invalid");
    expect(classifyOrderError(apiError("Minimum order ₹500 required for this outlet.")).kind).toBe(
      "minimum_order_not_met",
    );
  });

  it("falls back to a generic failure for anything unrecognised", () => {
    expect(classifyOrderError(apiError("Something went wrong.")).kind).toBe("unknown");
    expect(classifyOrderError(new Error("")).kind).toBe("unknown");
    expect(classifyOrderError(undefined).kind).toBe("unknown");
  });
});

describe("orderErrorDetail", () => {
  it("surfaces the server's actionable message", () => {
    const error = apiError(
      "Delivery not available at this outlet.",
      OrderDomainCode.ORDER_TYPE_UNAVAILABLE,
    );
    expect(orderErrorDetail(error)).toBe("Delivery not available at this outlet.");
  });

  it("omits the detail for an unknown failure so the caller can show its own", () => {
    expect(orderErrorDetail(apiError("boom"))).toBeUndefined();
  });
});

describe("domain code presence", () => {
  it("prefers the code over the message when both are present", () => {
    // Message says one thing, code says another — the code is the contract.
    const error = apiError(
      "Delivery not available at this outlet.",
      OrderDomainCode.OUTLET_UNAVAILABLE,
    );
    expect(classifyOrderError(error).kind).toBe("outlet_unavailable");
  });

  it("is still an ApiError so existing handling keeps working", () => {
    const error = apiError("nope", OrderDomainCode.COUPON_INVALID);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(400);
    expect(error.domainCode).toBe("COUPON_INVALID");
  });

  it("reads the code off a plain REST ApiError, not just the tRPC subclass", () => {
    // REST is the *primary* transport for every public endpoint, and the gateway
    // forwards `domainCode` on it. Gating on `instanceof TrpcError` here meant the
    // normal path had no code and always fell back to regex-matching English prose.
    const restError = new ApiError(
      "Delivery is not available at this outlet.",
      400,
      "/api/public/orders",
      "ORDER_TYPE_UNAVAILABLE",
    );
    expect(classifyOrderError(restError).kind).toBe("order_type_unavailable");
  });

  it("classifies from the message when a REST body carries no code", () => {
    const noCode = new ApiError("Delivery address is required.", 400, "/api/public/orders");
    expect(classifyOrderError(noCode).kind).toBe("delivery_address_required");
  });
});

/**
 * The exact strings starkupps-admin's `publicRouter.orders.create` throws.
 *
 * Duplicated on purpose: if someone rewords a server message and it starts
 * colliding with another bucket, this test fails here rather than a customer
 * seeing "Some items are unavailable at this outlet." for a delivery problem.
 */
describe("real server messages classify correctly", () => {
  const cases: Array<[string, string]> = [
    // `assertOrderTypeOrderable` now interpolates the label, so the message is
    // "Delivery is not available at this outlet." rather than the older fixed
    // per-method strings. Both wordings are listed: the code path is authoritative,
    // but a gateway that has not yet been redeployed still sends the old text.
    ["Delivery is not available at this outlet.", "order_type_unavailable"],
    ["Takeaway is not available at this outlet.", "order_type_unavailable"],
    ["Dine-in is not available at this outlet.", "order_type_unavailable"],
    ["Delivery not available at this outlet.", "order_type_unavailable"],
    ["Takeaway not available at this outlet.", "order_type_unavailable"],
    ["Dine-in not available at this outlet.", "order_type_unavailable"],
    [
      "This outlet is not accepting online orders right now. Please try again later.",
      "outlet_unavailable",
    ],
    [
      "This outlet is not accepting orders online at the moment. Please choose another outlet.",
      "no_order_types_available",
    ],
    ["Selected outlet is not accepting orders right now.", "outlet_unavailable"],
    ["Selected outlet not found.", "outlet_unavailable"],
    ["Delivery address is required.", "delivery_address_required"],
    ["Kulhad Pizza is COMING SOON and cannot be ordered yet.", "coming_soon"],
    ["Kulhad Pizza is not available at this outlet.", "item_unavailable"],
    ["Classic Cold Coffee — Large is not available.", "variant_unavailable"],
    ["Menu item 503 not found.", "invalid_selection"],
    ["Variant 999 not found.", "invalid_selection"],
    ["Variant does not belong to Kulhad Pizza.", "invalid_selection"],
    ["Please select a size for Kulhad Pizza.", "invalid_selection"],
    ["Modifier option 12 not found.", "invalid_selection"],
    ["Coupon not found.", "coupon_invalid"],
    ["Coupon expired.", "coupon_invalid"],
    ["Coupon not valid for this outlet.", "coupon_invalid"],
    ["Coupon not applicable to items in cart.", "coupon_invalid"],
    ["Minimum order ₹500 required for this outlet.", "minimum_order_not_met"],
    ["Minimum order ₹500 required for this coupon.", "minimum_order_not_met"],
  ];

  it.each(cases)("%s -> %s", (message, expected) => {
    expect(classifyOrderError(apiError(message)).kind).toBe(expected);
  });

  it("never blames the menu for an order-type rejection", () => {
    for (const [message] of cases.filter(([, kind]) => kind === "order_type_unavailable")) {
      expect(classifyOrderError(apiError(message)).title).not.toMatch(/items are unavailable/i);
    }
  });
});

import { describe, expect, it } from "vitest";

import {
  contactPhone,
  customerBlock,
  fulfillmentLabel,
  itemCount,
  paymentBlock,
  pricingBreakdown,
  splitNotes,
  type OrderDetailRecord,
} from "./order-detail";

/**
 * The customer information the Admin ticket was missing.
 *
 * `admin.orders.byId` has always returned `customerPhone` — the field reached the
 * browser and was never rendered. The delivery address was a genuine data loss:
 * validated as required for delivery orders, then discarded by the INSERT,
 * because the column to hold it did not exist.
 */
const deliveryOrder: OrderDetailRecord = {
  id: 40036,
  orderNumber: 1010,
  status: "new",
  type: "delivery",
  createdAt: "2026-10-03T14:58:00.000Z",
  updatedAt: "2026-10-03T14:58:00.000Z",
  notes: "Aacha sa banana less spicy",
  paymentStatus: "unpaid",
  source: "website",
  customerName: "Aashish kumar",
  customerPhone: "7545957093",
  customerEmail: "aashish@example.com",
  deliveryAddress: "12 Station Road, Near temple, Munger 813211",
  outletName: "StarKupps Cafe - Munger",
  subtotal: 55,
  couponDiscount: 0,
  packingCharge: 0,
  deliveryFee: 15,
  taxAmount: 0,
  chargesTotal: 15,
  taxBreakdown: null,
  total: 70,
  items: [
    {
      id: 1,
      quantity: 1,
      itemName: "Classic Cheese Burger",
      variantName: "Default",
      unitPrice: 55,
      lineTotal: 55,
      selectedModifiers: [],
    },
  ],
};

describe("contactPhone", () => {
  it("normalises the three shapes an Indian number arrives in", () => {
    for (const raw of [
      "9876543210",
      "+919876543210",
      "09876543210",
      "91 98765 43210",
    ]) {
      expect(contactPhone(raw)).toEqual({
        display: "9876543210",
        tel: "+919876543210",
      });
    }
  });

  it("does not present a landline as a mobile", () => {
    // `0612345678` is a 10-digit value with a leading `0` — an area code, not a
    // national mobile prefix. Stripping that 0 to "normalise" it would show and
    // dial the wrong number.
    // The leading `0` is India's international dialling prefix, so `+06…` is the
    // correct E.164 form; the point is only that it is not reshaped into a
    // 10-digit "mobile".
    expect(contactPhone("0612345678")).toEqual({
      display: "0612345678",
      tel: "+0612345678",
    });
  });

  it("still accepts a mobile carrying the 0 prefix", () => {
    expect(contactPhone("09876543210")).toEqual({
      display: "9876543210",
      tel: "+919876543210",
    });
  });

  it("returns null rather than a link that cannot dial", () => {
    expect(contactPhone("")).toEqual({ display: null, tel: null });
    expect(contactPhone("   ")).toEqual({ display: null, tel: null });
    expect(contactPhone("123")).toEqual({ display: null, tel: null });
    expect(contactPhone(null)).toEqual({ display: null, tel: null });
  });
});

describe("customerBlock", () => {
  it("surfaces name, phone, email and address for a delivery order", () => {
    const block = customerBlock(deliveryOrder);
    expect(block.name).toBe("Aashish kumar");
    expect(block.phoneLabel).toBe("7545957093");
    expect(block.phone).toBe("+917545957093");
    expect(block.email).toBe("aashish@example.com");
    expect(block.address).toBe("12 Station Road, Near temple, Munger 813211");
    expect(block.addressMissing).toBe(false);
  });

  it("flags a missing address on a delivery order instead of hiding it", () => {
    // A pre-migration row. The gap has to be *visible*: silently omitting the
    // field is what made this look like a rendering bug rather than data that
    // was never captured.
    const block = customerBlock({ ...deliveryOrder, deliveryAddress: null });
    expect(block.address).toBeNull();
    expect(block.addressMissing).toBe(true);
  });

  it("never shows an address for dine-in or takeaway", () => {
    for (const type of ["dine_in", "takeaway"]) {
      const block = customerBlock({ ...deliveryOrder, type });
      expect(block.address).toBeNull();
      expect(block.addressMissing).toBe(false);
    }
  });

  it("treats a whitespace-only address as absent", () => {
    expect(
      customerBlock({ ...deliveryOrder, deliveryAddress: "   " }).addressMissing
    ).toBe(true);
  });

  it("falls back to a walk-in label when there is no name", () => {
    expect(customerBlock({ ...deliveryOrder, customerName: null }).name).toBe(
      "Walk-in guest"
    );
  });

  it("reads a historical row whose snapshot is null but whose profile is joined", () => {
    // `orderDetail` coalesces the snapshot over the profile, so the projection
    // receives the resolved value. Asserting the shape here documents that the
    // coalescing happens server-side rather than in two places here.
    expect(
      customerBlock({
        ...deliveryOrder,
        customerName: null,
        customerPhone: null,
      }).name
    ).toBe("Walk-in guest");
  });
});

describe("pricingBreakdown", () => {
  it("itemises a fully-snapshotted order", () => {
    const { lines, total } = pricingBreakdown({
      ...deliveryOrder,
      subtotal: 100,
      couponDiscount: 20,
      couponCode: "WELCOME50",
      packingCharge: 15,
      deliveryFee: 29,
      taxAmount: 2.75,
      chargesTotal: 46.75,
      taxBreakdown: [
        { name: "CGST", rate: 2.5, amount: 2 },
        { name: "SGST", rate: 2.5, amount: 0.75 },
      ],
      total: 126.75,
    });
    expect(lines).toEqual([
      { label: "Subtotal", value: 100 },
      { label: "Discount · WELCOME50", value: -20 },
      { label: "Packaging", value: 15 },
      { label: "Delivery", value: 29 },
      { label: "CGST (2.5%)", value: 2 },
      { label: "SGST (2.5%)", value: 0.75 },
    ]);
    expect(total).toBe(126.75);
  });

  it("reconciles a stored total that its components do not explain", () => {
    // Every pre-migration row: packing/delivery/tax were never broken out, but
    // `total - subtotal + couponDiscount` recovers the combined figure. Showing
    // that honestly beats inventing a split.
    const { lines, total } = pricingBreakdown({
      ...deliveryOrder,
      packingCharge: 0,
      deliveryFee: 0,
      taxAmount: 0,
      chargesTotal: 15,
      total: 70,
    });
    expect(lines).toContainEqual({
      label: "Charges & taxes",
      value: 15,
      muted: true,
    });
    expect(total).toBe(70);
  });

  it("omits zero-value lines so a takeaway ticket has no empty delivery row", () => {
    const { lines } = pricingBreakdown({
      ...deliveryOrder,
      type: "takeaway",
      deliveryFee: 0,
    });
    expect(lines.some(l => l.label === "Delivery")).toBe(false);
    expect(lines.some(l => l.label === "Discount")).toBe(false);
  });

  it("shows a delivery fee only for a delivery ticket", () => {
    // A takeaway order that somehow carries a stored delivery fee must not
    // display one — that is a pricing bug the ticket should not launder.
    const { lines } = pricingBreakdown({ ...deliveryOrder, type: "takeaway" });
    expect(lines.some(l => l.label === "Delivery")).toBe(false);
  });

  it("does not add a reconciliation line when the components already add up", () => {
    const { lines } = pricingBreakdown({
      ...deliveryOrder,
      packingCharge: 0,
      deliveryFee: 15,
      taxAmount: 0,
      chargesTotal: 15,
    });
    expect(lines.some(l => l.label === "Charges & taxes")).toBe(false);
  });

  it("falls back to a single tax line when no breakdown was stored", () => {
    const { lines } = pricingBreakdown({
      ...deliveryOrder,
      taxAmount: 5,
      chargesTotal: 20,
      taxBreakdown: null,
    });
    expect(lines).toContainEqual({ label: "Tax", value: 5 });
  });

  it("survives a null or non-array taxBreakdown without throwing", () => {
    // Legacy rows can hold a JSON *string*; `.map()` on one would throw inside
    // render and drop the whole ticket into the error boundary.
    for (const taxBreakdown of [null, undefined, "[]", "{bad", 42, {}]) {
      expect(() =>
        pricingBreakdown({ ...deliveryOrder, taxBreakdown } as never)
      ).not.toThrow();
    }
  });

  it("never reports a null total as zero", () => {
    expect(pricingBreakdown({ ...deliveryOrder, total: null }).total).toBe(0);
    expect(
      pricingBreakdown({ ...deliveryOrder, subtotal: null }).lines[0]
    ).toEqual({
      label: "Subtotal",
      value: 0,
    });
  });
});

describe("splitNotes", () => {
  it("keeps the customer note separate from the cancellation reason", () => {
    const { customerNote, internalNote } = splitNotes(
      "Aacha sa banana less spicy\nCancellation: customer called to cancel"
    );
    expect(customerNote).toBe("Aacha sa banana less spicy");
    expect(internalNote).toBe("customer called to cancel");
  });

  it("treats a note with no cancellation marker as the customer's", () => {
    expect(splitNotes("Less spicy please").customerNote).toBe(
      "Less spicy please"
    );
    expect(splitNotes("Less spicy please").internalNote).toBeNull();
  });

  it("handles a cancellation with no customer note", () => {
    const parsed = splitNotes("Cancellation: out of stock");
    expect(parsed.customerNote).toBeNull();
    expect(parsed.internalNote).toBe("out of stock");
  });

  it("preserves newlines inside a multi-line customer note", () => {
    const parsed = splitNotes("Leave at gate\nCall on arrival");
    expect(parsed.customerNote).toBe("Leave at gate\nCall on arrival");
  });

  it("returns nulls for absent notes rather than an empty string", () => {
    expect(splitNotes(null)).toEqual({
      customerNote: null,
      internalNote: null,
    });
    expect(splitNotes("")).toEqual({ customerNote: null, internalNote: null });
    expect(splitNotes("   ")).toEqual({
      customerNote: null,
      internalNote: null,
    });
  });
});

describe("paymentBlock", () => {
  it("never infers paid from the order existing", () => {
    // `orders.paymentStatus` defaults to `unpaid`, and creating an order does not
    // collect money. This is the check that stops the ticket reading as a receipt.
    expect(paymentBlock(deliveryOrder)).toMatchObject({
      paid: false,
      tone: "pending",
    });
  });

  it("reports a paid order distinctly", () => {
    expect(
      paymentBlock({ ...deliveryOrder, paymentStatus: "paid" })
    ).toMatchObject({ paid: true, tone: "ok" });
  });

  it("reports a failed payment as failed, not merely pending", () => {
    expect(
      paymentBlock({ ...deliveryOrder, paymentStatus: "failed" })
    ).toMatchObject({
      paid: false,
      tone: "failed",
    });
  });

  it("returns null when the order predates payment tracking", () => {
    expect(paymentBlock({ ...deliveryOrder, paymentStatus: null })).toBeNull();
  });
});

describe("misc helpers", () => {
  it("labels fulfilment types in customer-facing casing", () => {
    expect(fulfillmentLabel("dine_in")).toBe("Dine-in");
    expect(fulfillmentLabel("takeaway")).toBe("Takeaway");
    expect(fulfillmentLabel("delivery")).toBe("Delivery");
  });

  it("shows an unknown type rather than hiding it", () => {
    expect(fulfillmentLabel("scheduled_pickup")).toBe("scheduled pickup");
    expect(fulfillmentLabel(null)).toBe("—");
  });

  it("counts items by quantity, not by line", () => {
    // A line of 3 is three drinks for prep purposes; counting lines understated
    // the workload.
    expect(
      itemCount([
        { id: 1, quantity: 3, itemName: "Coffee" },
        { id: 2, quantity: 2, itemName: "Cake" },
      ])
    ).toBe(5);
    expect(itemCount(null)).toBe(0);
  });
});

/**
 * Read-only projection of a persisted order for the Admin ticket.
 *
 * ## Why this is not a template
 *
 * The order detail used to be rendered by reaching into `any` at the point of
 * use (`order.customerPhone`, `order.deliveryAddress`, …). That has two costs
 * worth avoiding here:
 *
 * * It hid the fact that `customerPhone` *was* already being returned by
 *   `admin.orders.byId` — the field existed in the API response and was simply
 *   never rendered. A phone number the customer gave for updates was invisible
 *   to the person handing them the order.
 * * Every field needed a defensive fallback at the render site, so the handling
 *   of a missing value (a pre-migration row with no address) was decided in
 *   seven different places.
 *
 * Centralising it means the "what if this is absent" decisions are made once,
 * against `unknown`, and the dialog below can be written against real types.
 *
 * ## Unknown vs zero
 *
 * The distinction matters for money. A row created before the snapshot columns
 * existed has `deliveryAddress === null` ("we do not know") and a row for a
 * dine-in order has `deliveryAddress === null` too ("not applicable"). Numeric
 * charges are different: `packingCharge === 0` is a genuine zero (dine-in is
 * never charged packing), so it renders as ₹0, never as "unavailable".
 */
import { ORDER_TYPE_LABEL, type ApiOrderType } from "@shared/outletServices";

export type OrderModifier = {
  name: string;
  priceDelta?: number;
};

export type OrderLine = {
  id: number;
  quantity: number;
  itemName: string;
  variantName?: string | null;
  variantQuantity?: number | string | null;
  variantUnit?: string | null;
  sku?: string | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
  selectedModifiers?: OrderModifier[] | null;
};

export type OrderTaxLine = { name: string; rate: number; amount: number };

/** Raw order row as returned by `admin.orders.byId`. */
export type OrderDetailRecord = {
  id: number;
  orderNumber: number;
  status: string;
  type: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  notes?: string | null;
  paymentStatus?: string | null;
  source?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  deliveryAddress?: string | null;
  outletName?: string | null;
  subtotal?: number | null;
  couponDiscount?: number | null;
  couponCode?: string | null;
  packingCharge?: number | null;
  deliveryFee?: number | null;
  taxAmount?: number | null;
  chargesTotal?: number | null;
  taxBreakdown?: OrderTaxLine[] | null;
  total?: number | null;
  items?: OrderLine[] | null;
};

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** `dine_in` → `Dine-in`; an unknown value is shown verbatim rather than hidden. */
export function fulfillmentLabel(type: unknown): string {
  if (typeof type !== "string" || !type) return "—";
  return (
    (ORDER_TYPE_LABEL as Record<string, string>)[type] ??
    type.replace(/_/g, " ")
  );
}

/**
 * "Dine-in", "Takeaway" or "Delivery" — used to decide whether an address is
 * meaningful at all.
 */
export function isDelivery(type: unknown): boolean {
  return type === "delivery";
}

export type CustomerBlock = {
  name: string;
  /** `tel:` href, or null when there is no usable number to call. */
  phone: string | null;
  phoneLabel: string;
  email: string | null;
  /** For delivery orders only; null otherwise, so a stale address is never shown. */
  address: string | null;
  /** True when a delivery order exists but the address was never recorded. */
  addressMissing: boolean;
};

/**
 * Normalises a phone number for display and for a `tel:` link.
 *
 * Indian mobile numbers are stored in several shapes (`9876543210`,
 * `+919876543210`, `09876543210`). `tel:` needs the country code, and a raw
 * number with stray punctuation dials nothing, so both are derived here rather
 * than guessed at each call site. Returns null for anything that is not a
 * plausible number, so the UI can hide the call action instead of offering a
 * link that fails.
 */
export function contactPhone(raw: unknown): {
  display: string | null;
  tel: string | null;
} {
  if (typeof raw !== "string") return { display: null, tel: null };
  const trimmed = raw.trim();
  if (!trimmed) return { display: null, tel: null };
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8) return { display: null, tel: null };
  // India: a bare 10-digit mobile, or the same with 91 / 0 in front. Only a
  // number starting 6-9 counts — a 10-digit value beginning `0` is a landline
  // with an area code (`0612345678`), and stripping that 0 to present it as a
  // mobile would dial the wrong thing.
  const isMobile = (value: string) => /^[6-9]\d{9}$/.test(value);
  const national =
    digits.length === 12 && digits.startsWith("91")
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith("0")
        ? digits.slice(1)
        : digits;
  if (isMobile(national)) {
    return { display: national, tel: `+91${national}` };
  }
  // Anything else (a landline, or a number stored in an unexpected format) is
  // still worth showing and dialling — just not reformatted.
  return { display: trimmed, tel: `+${digits}` };
}

export function customerBlock(order: OrderDetailRecord): CustomerBlock {
  const { display, tel } = contactPhone(order.customerPhone);
  const delivery = isDelivery(order.type);
  const address =
    delivery && typeof order.deliveryAddress === "string"
      ? order.deliveryAddress.trim() || null
      : null;
  return {
    name: order.customerName?.trim() || "Walk-in guest",
    phone: tel,
    phoneLabel: display ?? "",
    email: order.customerEmail?.trim() || null,
    address,
    // Only meaningful for delivery. A takeaway ticket with no address is
    // correct, not missing information.
    addressMissing: delivery && address === null,
  };
}

export type PriceLine = { label: string; value: number; muted?: boolean };

/**
 * The persisted pricing breakdown, with only relevant components shown.
 *
 * Built from the stored figures rather than recomputed, so the Admin total
 * always equals the customer's charged total. Components worth zero are omitted
 * (a ₹0 delivery line on a takeaway ticket is noise) with one exception:
 * `chargesTotal` is shown whenever it is non-zero *and* the individual
 * components do not add up to it, which is exactly the pre-migration case where
 * packing/delivery/tax were never broken out. Showing only "Charges ₹15" there is
 * honest; inventing a split would not be.
 */
export function pricingBreakdown(order: OrderDetailRecord): {
  lines: PriceLine[];
  total: number;
} {
  const subtotal = num(order.subtotal);
  const discount = num(order.couponDiscount);
  const packing = num(order.packingCharge);
  const delivery = num(order.deliveryFee);
  const tax = num(order.taxAmount);
  const charges = num(order.chargesTotal);
  const taxLines = Array.isArray(order.taxBreakdown) ? order.taxBreakdown : [];

  const lines: PriceLine[] = [{ label: "Subtotal", value: subtotal }];
  if (discount > 0) {
    lines.push({
      label: order.couponCode ? `Discount · ${order.couponCode}` : "Discount",
      value: -discount,
    });
  }
  if (packing > 0) lines.push({ label: "Packaging", value: packing });
  // Gated on the fulfilment type, not just on the value. `computeOrderQuote`
  // never charges delivery for dine-in or takeaway, so a stored `deliveryFee`
  // on one of those is a data problem — rendering it would launder the bug into
  // an apparently legitimate total the customer would not have been charged.
  if (delivery > 0 && isDelivery(order.type)) {
    lines.push({ label: "Delivery", value: delivery });
  }

  if (taxLines.length > 0) {
    for (const line of taxLines) {
      if (line.amount > 0) {
        lines.push({
          label: `${line.name} (${line.rate}%)`,
          value: num(line.amount),
        });
      }
    }
  } else if (tax > 0) {
    lines.push({ label: "Tax", value: tax });
  }

  const components = packing + delivery + tax;
  // A stored total that the itemised lines do not explain — the shape of every
  // order placed before the breakdown was persisted.
  if (charges > 0 && Math.abs(charges - components) > 0.01) {
    lines.push({
      label: "Charges & taxes",
      value: charges,
      muted: true,
    });
  }

  return { lines, total: num(order.total) };
}

/**
 * The customer's own note, separated from internal annotations.
 *
 * Cancellation reasons are appended to `orders.notes` by `admin.orders.cancel`
 * (there is no separate internal-notes column), so a cancelled ticket shows both.
 * Splitting them here keeps the customer's instruction — the thing the kitchen
 * needs — visually distinct from the staff-facing reason.
 */
export function splitNotes(notes: unknown): {
  customerNote: string | null;
  internalNote: string | null;
} {
  if (typeof notes !== "string")
    return { customerNote: null, internalNote: null };
  // The marker may start the string (an order cancelled before any note was
  // left) or follow one. Anchoring on `\n` alone missed the first case, which
  // then rendered "Cancellation: out of stock" as if the customer had written it.
  const match = /(?:\r?\n|^)[ \t]*Cancellation:[ \t]*/i.exec(notes);
  if (!match) {
    const trimmed = notes.trim();
    return { customerNote: trimmed || null, internalNote: null };
  }
  const customerNote = notes.slice(0, match.index).trim();
  const internalNote = notes.slice(match.index + match[0].length).trim();
  return {
    customerNote: customerNote || null,
    internalNote: internalNote || null,
  };
}

export type PaymentBlock = {
  method: string;
  status: string;
  paid: boolean;
  tone: "ok" | "pending" | "failed";
};

/**
 * Payment state.
 *
 * Never infers "paid" from the order merely existing: `orders.paymentStatus`
 * defaults to `unpaid`, and creating an order does not collect money. This is
 * why the previous total-only summary was actively misleading — it read like a
 * receipt with no indication that nothing had been taken.
 */
export function paymentBlock(order: OrderDetailRecord): PaymentBlock | null {
  const status = (order.paymentStatus ?? "").toLowerCase();
  if (!status) return null;
  const method =
    order.source === "website"
      ? "Online (unconfirmed)"
      : `Recorded · ${order.source ?? "counter"}`;
  if (status === "paid") return { method, status, paid: true, tone: "ok" };
  if (status === "failed")
    return { method, status, paid: false, tone: "failed" };
  return { method, status, paid: false, tone: "pending" };
}

/** Item count by quantity, not by line — the number a counter actually needs. */
export function itemCount(items: OrderLine[] | null | undefined): number {
  return (items ?? []).reduce(
    (sum, item) => sum + (Number(item.quantity) || 0),
    0
  );
}

export type { ApiOrderType };

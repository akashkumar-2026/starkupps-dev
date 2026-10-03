/** Order, checkout and charge types shared by the cart and account features. */

/** Client-side order mode. The API uses `snake_case`; see `toApiOrderType`. */
export type OrderType = "dine-in" | "takeaway" | "delivery";

export type ApiOrderType = "dine_in" | "takeaway" | "delivery";

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  "dine-in": "Dine-in",
  takeaway: "Takeaway",
  delivery: "Delivery",
};

/** Selected modifier, sent to the API and echoed back on the stored order. */
export type SelectedModifier = {
  name: string;
  priceDelta: number;
  groupId?: number | undefined;
  optionId?: number | undefined;
};

export type CreateOrderItem = {
  menuItemId: number;
  variantId: number;
  quantity: number;
  selectedModifiers?: SelectedModifier[] | null;
};

export type CreateOrderInput = {
  outletId: number;
  type: ApiOrderType;
  customer: {
    name: string;
    phone: string;
    address?: string | null;
    email?: string | null;
  };
  notes?: string | null;
  couponCode?: string | null;
  idempotencyKey?: string | null;
  items: CreateOrderItem[];
};

export type CreatedOrder = {
  id: number;
  orderNumber: number;
  status: string;
  subtotal: number;
  couponDiscount: number;
  charges: number;
  total: number;
  outletId: number;
  /** `true` when an idempotency key replayed an existing order. */
  already?: boolean;
};

/**
 * An address suggestion derived from device coordinates.
 *
 * Always a draft. `attribution` is required by the OpenStreetMap licence the
 * underlying data comes from, so it is carried through to the caller rather
 * than dropped here.
 */
export type ReverseGeocodeResult = {
  address: string;
  locality: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  attribution: string;
  cached: boolean;
};

export type CouponValidationInput = {
  code: string;
  outletId?: number | null;
  orderType?: string | null;
  customerPhone?: string | null;
  orderAmount?: number;
  items?: Array<{
    menuItemId: number | null;
    categoryId: number | null;
    quantity: number;
    lineTotal: number;
  }>;
};

export type CouponValidation = {
  valid: boolean;
  reason?: string;
  discount?: number;
  eligibleAmount?: number;
};

export type ChargeQuote = {
  outletId: number;
  packing: number;
  delivery: number;
  tax: number;
  taxLines: Array<{ name: string; rate: number; amount: number }>;
  chargesTotal: number;
  total: number;
  freeDeliveryAbove: number | null;
  packingCharge: number;
  deliveryFee: number;
};

export type OrderTrackToken = { token: string };

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const TIME = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
});

const DATE = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** Formats whole rupees for display. Amounts are stored in paise-free rupees. */
export function inr(value: number | null | undefined): string {
  return INR.format(value ?? 0);
}

/**
 * Currency, or an explicit "unavailable" marker when the value is genuinely
 * unknown.
 *
 * `inr(null)` returns "₹0", which is indistinguishable from a real zero. Several
 * aggregates are nullable precisely because the backend could not compute them,
 * and rendering those as ₹0 would report a fabricated figure.
 */
export function inrOrUnavailable(
  value: number | null | undefined,
  label = "unavailable"
): string {
  return value === null || value === undefined ? label : INR.format(value);
}

/** `14:05` in the store's locale. */
export function timeLabel(
  value: Date | string | number | null | undefined
): string {
  if (value === null || value === undefined) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : TIME.format(date);
}

/** `09 Aug 2026`, or an em dash when the value is missing or unparseable. */
export function dateText(
  value: Date | string | number | null | undefined
): string {
  if (value === null || value === undefined) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : DATE.format(date);
}

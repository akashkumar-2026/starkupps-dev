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

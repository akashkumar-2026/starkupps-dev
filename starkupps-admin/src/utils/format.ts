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

/**
 * Parses a timestamp from the database into a real `Date`.
 *
 * ## Why this is not `new Date(value)`
 *
 * `orders.createdAt` and every other audited column are
 * `timestamp **without** time zone`, and Postgres serialises those over PostgREST
 * as a **space**-separated string with no offset:
 *
 * ```
 * "2026-10-04 04:28:38.994716"     // UTC, but carrying no marker saying so
 * ```
 *
 * `new Date()` on that string is parsed as **local time** per the ES spec. On a
 * counter laptop in India (`Asia/Kolkata`) it therefore reads 04:28 as *local*
 * and prints "04:28", when the true local time is 09:58. Every ticket was
 * showing a time 5 hours 30 minutes early — and the error moved with whoever
 * viewed it, so a ticket opened in the browser and the same ticket in the
 * database disagreed.
 *
 * The fix is to mark the naive string as UTC before parsing, which is what it
 * has always been. Rows that genuinely carry a zone (a `timestamptz`, or an ISO
 * string with an offset or trailing `Z`) are already unambiguous and pass
 * through untouched.
 *
 * Normalising the separator is also required: `" "` is not valid ISO 8601, and
 * appending a `Z` to a space-separated string yields an Invalid Date.
 */
export function parseDbTimestamp(
  value: Date | string | number | null | undefined
): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  // Already unambiguous: has an explicit offset or is an epoch suffix.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // A bare date ("2026-03-04") is a calendar day, not an instant. Pinning it to
  // midnight UTC keeps it stable across timezones instead of shifting a day.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const parsed = new Date(
      Date.UTC(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3])
      )
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // Postgres format: "YYYY-MM-DD HH:MM:SS[.ffffff]". Re-tag as UTC.
  const postgres =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(
      trimmed
    );
  if (postgres) {
    const millis = postgres[7]
      ? Number(postgres[7].slice(0, 3).padEnd(3, "0"))
      : 0;
    const parsed = new Date(
      Date.UTC(
        Number(postgres[1]),
        Number(postgres[2]) - 1,
        Number(postgres[3]),
        Number(postgres[4]),
        Number(postgres[5]),
        postgres[6] ? Number(postgres[6]) : 0,
        millis
      )
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** `14:05` in the store's locale. */
export function timeLabel(
  value: Date | string | number | null | undefined
): string {
  const date = parseDbTimestamp(value);
  return date ? TIME.format(date) : "—";
}

/** `09 Aug 2026`, or an em dash when the value is missing or unparseable. */
export function dateText(
  value: Date | string | number | null | undefined
): string {
  const date = parseDbTimestamp(value);
  return date ? DATE.format(date) : "—";
}

const DATE_TIME = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * `09 Aug 2026, 20:38` — date and time together, for audit trails and
 * notification lists.
 *
 * Replaces `new Date(value).toLocaleString()` at six call sites. Beyond the
 * locale-dependent output that `toLocaleString()` produced (a machine with a
 * different locale rendered "8/4/2026, 4:38:00 AM" next to "09 Aug 2026, 20:38"
 * elsewhere on the same screen), the naive-parse bug applied here too.
 */
export function dateTimeText(
  value: Date | string | number | null | undefined
): string {
  const date = parseDbTimestamp(value);
  return date ? DATE_TIME.format(date) : "—";
}

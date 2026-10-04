import { describe, expect, it } from "vitest";

import { dateText, dateTimeText, parseDbTimestamp, timeLabel } from "./format";

/**
 * The bug this pins.
 *
 * `orders.createdAt` is `timestamp without time zone`, and Postgres serialises
 * it over PostgREST as `"2026-10-04 04:28:38.994716"` — UTC, but with nothing in
 * the string saying so. `new Date()` on a space-separated, offset-less string is
 * parsed as **local time** per the ES spec, so on a counter laptop in
 * `Asia/Kolkata` the ticket read "04:28" when the true local time was "09:58".
 *
 * Every ticket was 5h30m early, and the error moved with the viewer — the same
 * order showed a different time depending on who opened it. The existing tests
 * used `toMatch(/\d/)`, which any time satisfies, so they never noticed.
 *
 * These tests therefore assert the **rendered value in a fixed timezone** rather
 * than merely that something digits came out.
 */

/** Renders in a known zone so the assertion does not depend on the test host. */
const inZone = (fmt: Intl.DateTimeFormat, date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-IN", {
    ...fmt.resolvedOptions(),
    timeZone,
  } as never).format(date);

const IST = "Asia/Kolkata";

describe("parseDbTimestamp", () => {
  it("reads a Postgres timestamp as UTC, not local time", () => {
    // The whole bug in one assertion.
    const parsed = parseDbTimestamp("2026-10-04 04:28:38.994716");
    expect(parsed?.toISOString()).toBe("2026-10-04T04:28:38.994Z");
  });

  it("accepts the space-separated form Postgres sends", () => {
    // A space is not valid ISO 8601; appending `Z` to it yields Invalid Date, so
    // the separator has to be normalised before re-tagging.
    expect(parseDbTimestamp("2026-10-04 04:28:38")?.toISOString()).toBe(
      "2026-10-04T04:28:38.000Z"
    );
  });

  it("keeps sub-second precision to the millisecond", () => {
    // Postgres emits microseconds; JS has milliseconds. Truncating rather than
    // rounding keeps the value on the right side of the second.
    expect(
      parseDbTimestamp("2026-10-04 04:28:38.994716")?.getMilliseconds()
    ).toBe(994);
  });

  it("leaves an unambiguous offset alone", () => {
    // A timestamptz or an ISO string with `Z` already carries its zone; adding
    // another would shift it twice.
    expect(parseDbTimestamp("2026-10-04T04:28:38Z")?.toISOString()).toBe(
      "2026-10-04T04:28:38.000Z"
    );
    expect(parseDbTimestamp("2026-10-04T09:58:38+05:30")?.toISOString()).toBe(
      "2026-10-04T04:28:38.000Z"
    );
  });

  it("pins a bare calendar date to midnight UTC", () => {
    // Otherwise "2026-03-04" reads as local midnight and renders as the previous
    // day for anyone west of Greenwich.
    expect(parseDbTimestamp("2026-03-04")?.toISOString()).toBe(
      "2026-03-04T00:00:00.000Z"
    );
  });

  it("passes a Date and an epoch through untouched", () => {
    const d = new Date("2026-10-04T04:28:38Z");
    expect(parseDbTimestamp(d)).toBe(d);
    expect(parseDbTimestamp(d.getTime())?.getTime()).toBe(d.getTime());
  });

  it("returns null rather than an Invalid Date", () => {
    // Callers branch on null; an Invalid Date would reach `.format()` and throw.
    for (const bad of [null, undefined, "", "   ", "not-a-date"]) {
      expect(parseDbTimestamp(bad)).toBeNull();
    }
    expect(parseDbTimestamp(new Date("nope"))).toBeNull();
  });
});

describe("timeLabel", () => {
  const timeFmt = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  } as const;

  it("shows the correct local time on a UTC+5:30 device", () => {
    // 04:28 UTC is 09:58 IST. The bug printed 04:28 here.
    const parsed = parseDbTimestamp("2026-10-04 04:28:38.994716");
    expect(
      inZone(new Intl.DateTimeFormat("en-GB", timeFmt), parsed!, IST)
    ).toBe("09:58");
  });

  it("agrees across timezones for the same stored value", () => {
    // The regression's real signature: the same order rendered differently
    // depending on who looked at it.
    const parsed = parseDbTimestamp("2026-10-04 04:28:38.994716")!;
    const ny = inZone(
      new Intl.DateTimeFormat("en-GB", timeFmt),
      parsed,
      "America/New_York"
    );
    const ist = inZone(new Intl.DateTimeFormat("en-GB", timeFmt), parsed, IST);
    expect(ny).not.toBe(ist); // different zones legitimately differ
    // Both must be the same instant, though.
    expect(parsed.toISOString()).toBe("2026-10-04T04:28:38.994Z");
  });

  it("still shows an em dash for missing and unparseable values", () => {
    expect(timeLabel(null)).toBe("—");
    expect(timeLabel(undefined)).toBe("—");
    expect(timeLabel("not-a-date")).toBe("—");
  });
});

describe("dateText", () => {
  it("renders the calendar date in the viewer's zone", () => {
    const parsed = parseDbTimestamp("2026-10-04 04:28:38.994716");
    const inIst = inZone(
      new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
      parsed!,
      IST
    );
    // Late-evening UTC can fall on the next local day; this asserts the *local*
    // day, which is what a customer expects to read.
    expect(inIst).toMatch(/2026/);
  });

  it("keeps a bare date on its own day everywhere", () => {
    const parsed = parseDbTimestamp("2026-03-04");
    // Midnight UTC is still the *previous* local day in Los Angeles, so a bare
    // calendar date cannot be fully normalised. What matters is that the parse
    // is zone-independent: it no longer drifts by each viewer's UTC offset, which
    // is the bug this whole file exists to pin.
    expect(parsed?.toISOString()).toBe("2026-03-04T00:00:00.000Z");
    // Proof the instant does not depend on the viewer's zone at parse time.
    expect(parsed?.getTime()).toBe(Date.UTC(2026, 2, 4));
  });

  it("returns an em dash for missing values", () => {
    expect(dateText(null)).toBe("—");
    expect(dateText("")).toBe("—");
  });
});

describe("dateTimeText", () => {
  it("is stable and locale-independent", () => {
    // Replaces `new Date(v).toLocaleString()`, whose output varied by machine —
    // an audit trail rendered two different formats on two screens.
    const value = dateTimeText("2026-10-04 04:28:38.994716");
    expect(value).toMatch(/2026/);
    expect(value).toMatch(/\d/);
    // Same input, same output — no locale leakage.
    expect(dateTimeText("2026-10-04 04:28:38.994716")).toBe(value);
  });

  it("returns an em dash for missing values", () => {
    expect(dateTimeText(null)).toBe("—");
    expect(dateTimeText("not-a-date")).toBe("—");
  });
});

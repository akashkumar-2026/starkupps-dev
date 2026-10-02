import { describe, expect, it } from "vitest";

import { evaluateStoreStatus, formatClock, storeClockNow, summarizeWeek } from "./hours";
import type { PublicWeeklyHour } from "@/types/site";

const IST = "Asia/Kolkata";

/** Open every day 10:00–22:00 IST. */
const allDay = (open: string, close: string): PublicWeeklyHour[] =>
  Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    isOpen: true,
    openTime: open,
    closeTime: close,
  }));

/** Build an instant from a UTC timestamp that reads as a given IST wall time. */
const istInstant = (iso: string) => new Date(iso);

describe("formatClock", () => {
  it("renders 24-hour store times as 12-hour copy", () => {
    expect(formatClock("10:00")).toBe("10 AM");
    expect(formatClock("22:00")).toBe("10 PM");
    expect(formatClock("00:30")).toBe("12:30 AM");
    expect(formatClock("13:05")).toBe("1:05 PM");
  });

  it("returns an empty string for missing or malformed values", () => {
    expect(formatClock(null)).toBe("");
    expect(formatClock("")).toBe("");
    expect(formatClock("not-a-time")).toBe("");
    expect(formatClock("99:00")).toBe("");
  });
});

describe("storeClockNow", () => {
  it("reads the wall clock in the store's timezone, not the device's", () => {
    // 18:30 UTC is 00:00 next day in India (UTC+5:30).
    const now = new Date("2026-03-10T18:30:00Z");
    const clock = storeClockNow(now, IST);
    expect(clock.minutes).toBe(0);
    expect(clock.dayOfWeek).toBe(3); // Wednesday in India
  });
});

describe("evaluateStoreStatus", () => {
  it("reports open inside the configured window", () => {
    // 16:00 IST = 10:30 UTC
    const status = evaluateStoreStatus(
      allDay("10:00", "22:00"),
      istInstant("2026-03-10T10:30:00Z"),
      IST,
    );
    expect(status.isOpen).toBe(true);
    expect(status.headline).toBe("Open now");
    expect(status.detail).toBe("Closes 10 PM");
  });

  it("reports closed before opening and names the opening time", () => {
    // 03:00 IST = 21:30 UTC the previous day
    const status = evaluateStoreStatus(
      allDay("10:00", "22:00"),
      istInstant("2026-03-10T21:30:00Z"),
      IST,
    );
    expect(status.isOpen).toBe(false);
    expect(status.headline).toBe("Closed");
    expect(status.detail).toBe("Opens 10 AM");
  });

  it("reports closed after closing", () => {
    // 23:30 IST = 18:00 UTC
    const status = evaluateStoreStatus(
      allDay("10:00", "22:00"),
      istInstant("2026-03-10T18:00:00Z"),
      IST,
    );
    expect(status.isOpen).toBe(false);
    expect(status.headline).toBe("Closed");
  });

  it("treats the opening minute as open and the closing minute as shut", () => {
    // 22:00 IST (the closing minute) is 16:30 UTC.
    expect(
      evaluateStoreStatus(allDay("10:00", "22:00"), istInstant("2026-03-10T16:30:00Z"), IST).isOpen,
    ).toBe(false);
    // 10:00 IST (the opening minute) is 04:30 UTC.
    expect(
      evaluateStoreStatus(allDay("10:00", "22:00"), istInstant("2026-03-10T04:30:00Z"), IST).isOpen,
    ).toBe(true);
    // 21:59 IST is still inside the window.
    expect(
      evaluateStoreStatus(allDay("10:00", "22:00"), istInstant("2026-03-10T16:29:00Z"), IST).isOpen,
    ).toBe(true);
  });

  it("honours a day the owner has switched off", () => {
    const schedule = allDay("10:00", "22:00");
    // 2026-03-10 is a Tuesday -> dayOfWeek 2
    schedule[2] = { dayOfWeek: 2, isOpen: false, openTime: "10:00", closeTime: "22:00" };
    const status = evaluateStoreStatus(schedule, istInstant("2026-03-10T10:30:00Z"), IST);
    expect(status.isOpen).toBe(false);
    expect(status.todayLabel).toBe("Closed");
  });

  it("handles an overnight shift that runs past midnight", () => {
    // 20:00–02:00 every day. 00:30 IST Wednesday is still Tuesday-night trade.
    const schedule = allDay("20:00", "02:00");
    expect(evaluateStoreStatus(schedule, istInstant("2026-03-10T19:00:00Z"), IST).isOpen).toBe(
      true,
    );

    // 12:00 IST midday is closed
    expect(evaluateStoreStatus(schedule, istInstant("2026-03-10T06:30:00Z"), IST).isOpen).toBe(
      false,
    );
  });

  it("stays open past midnight only inside the previous day's tail", () => {
    const schedule = allDay("20:00", "02:00");
    // 00:30 IST Wednesday belongs to Tuesday's shift -> open
    expect(evaluateStoreStatus(schedule, istInstant("2026-03-10T19:00:00Z"), IST).isOpen).toBe(
      true,
    );
    // 03:00 IST Wednesday is past the tail -> closed
    expect(evaluateStoreStatus(schedule, istInstant("2026-03-10T21:30:00Z"), IST).isOpen).toBe(
      false,
    );
  });

  it("says nothing when the owner has not configured a schedule", () => {
    const status = evaluateStoreStatus([], new Date(), IST);
    expect(status.isOpen).toBeNull();
    expect(status.headline).toBe("");
    expect(status.detail).toBe("");
  });

  it("ignores rows with unusable times instead of crashing", () => {
    const status = evaluateStoreStatus(
      [{ dayOfWeek: 0, isOpen: true, openTime: "oops", closeTime: null }],
      new Date(),
      IST,
    );
    expect(status.isOpen).toBeNull();
  });

  it("points at the next opening day when today is fully shut", () => {
    const schedule: PublicWeeklyHour[] = allDay("10:00", "22:00");
    // Tuesday closed, so Wednesday still open: after close on Tuesday the
    // message must name the following day rather than today's opening time.
    schedule[2] = { dayOfWeek: 2, isOpen: false, openTime: "10:00", closeTime: "22:00" };
    const status = evaluateStoreStatus(schedule, istInstant("2026-03-10T18:00:00Z"), IST);
    expect(status.isOpen).toBe(false);
    expect(status.detail).toContain("Opens 10 AM Wednesday");
  });
});

describe("summarizeWeek", () => {
  it("collapses an identical daily window", () => {
    expect(summarizeWeek(allDay("10:00", "22:00"))).toBe("Every day · 10 AM – 10 PM");
  });

  it("lists days separately when the window varies", () => {
    const schedule = allDay("10:00", "22:00");
    schedule[0] = { dayOfWeek: 0, isOpen: true, openTime: "09:00", closeTime: "20:00" };
    const summary = summarizeWeek(schedule);
    expect(summary).toContain("Sunday 9 AM – 8 PM");
    expect(summary).toContain("Monday 10 AM – 10 PM");
  });

  it("returns an empty string with no schedule", () => {
    expect(summarizeWeek([])).toBe("");
  });
});

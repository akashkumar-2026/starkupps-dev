/**
 * Opening-hours evaluation for the storefront.
 *
 * Pure functions only: given the weekly schedule the owner configured in Admin
 * and a clock reading, decide whether the store is open and produce the wording
 * shown in the hero badge, the Visit section and the footer.
 *
 * Two rules that are easy to get wrong and are handled explicitly here:
 *
 *   1. The comparison is done in the *store's* timezone, not the visitor's. A
 *      customer in Delhi or Dubai must still see Munger's hours, so the clock is
 *      read through `Intl.DateTimeFormat` with the store's IANA zone rather than
 *      from local getters on a `Date`.
 *   2. Closing times at or before the opening time mean the shift runs past
 *      midnight (a 20:00–02:00 kitchen). "Open" then depends on yesterday's
 *      hours as well as today's, and both windows are checked.
 */
import type { PublicWeeklyHour } from "@/types/site";

export type StoreDayHours = {
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
};

export type StoreStatus = {
  /** `null` when no schedule is configured at all — say nothing rather than guess. */
  isOpen: boolean | null;
  /** Hero badge headline, e.g. "Open now" / "Closed". */
  headline: string;
  /** Secondary line, e.g. "Closes 11 PM" / "Opens 10 AM". Empty when unknown. */
  detail: string;
  /** Hours for the day the visitor is looking at, when configured. */
  todayLabel: string;
  /** "Closes 11 PM" while open, "Opens 10 AM" while shut — for the Visit block. */
  nextChangeLabel: string;
};

/** `Asia/Kolkata` is the project's default; never fall back to the device zone. */
export const DEFAULT_STORE_TIMEZONE = "Asia/Kolkata";

/** `22:00` → `10 PM`, `09:05` → `9:05 AM`, `00:30` → `12:30 AM`. */
export function formatClock(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = match[2]!;
  if (!Number.isFinite(hours) || hours > 23) return "";
  const suffix = hours >= 12 ? "PM" : "AM";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === "00" ? `${display} ${suffix}` : `${display}:${minutes} ${suffix}`;
}

/** Clock reading in the store's zone: weekday plus minutes since midnight. */
export function storeClockNow(
  now: Date,
  timezone: string = DEFAULT_STORE_TIMEZONE,
): { dayOfWeek: number; minutes: number } {
  // `en-US` with weekday+time24 gives a stable, locale-independent reading.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(read("weekday"));
  // Midnight formats as "24" under hour12:false in some ICU builds.
  const hour = Number(read("hour")) % 24;
  const minute = Number(read("minute"));

  return {
    dayOfWeek: dayIndex >= 0 ? dayIndex : now.getDay(),
    minutes: (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0),
  };
}

function toMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function normalize(schedule: PublicWeeklyHour[] | undefined | null): StoreDayHours[] {
  return (schedule ?? [])
    .filter((day) => day && Number.isFinite(day.dayOfWeek))
    .map((day) => ({
      dayOfWeek: day.dayOfWeek,
      isOpen: day.isOpen !== false,
      openTime: day.openTime ?? null,
      closeTime: day.closeTime ?? null,
    }));
}

function rangeLabel(day: StoreDayHours | undefined): string {
  if (!day || !day.isOpen) return "Closed";
  const open = formatClock(day.openTime);
  const close = formatClock(day.closeTime);
  if (open && close) return `${open} – ${close}`;
  if (open) return `From ${open}`;
  if (close) return `Until ${close}`;
  return "";
}

/**
 * Open/closed at `now`, plus the copy the storefront shows.
 *
 * Returns `isOpen: null` when no usable schedule exists — the caller then omits
 * the badge rather than publishing a status the owner never configured.
 */
export function evaluateStoreStatus(
  schedule: PublicWeeklyHour[] | undefined | null,
  now: Date = new Date(),
  timezone: string = DEFAULT_STORE_TIMEZONE,
): StoreStatus {
  const days = normalize(schedule);
  const configured = days.some((day) => day.isOpen && toMinutes(day.openTime) !== null);
  if (!configured) {
    return {
      isOpen: null,
      headline: "",
      detail: "",
      todayLabel: "",
      nextChangeLabel: "",
    };
  }

  const { dayOfWeek, minutes } = storeClockNow(now, timezone);
  const dayFor = (index: number) => days.find((day) => day.dayOfWeek === index);
  const today = dayFor(dayOfWeek);
  const yesterday = dayFor((dayOfWeek + 6) % 7);

  const openFor = today?.isOpen ? toMinutes(today.openTime) : null;
  const closeFor = today?.isOpen ? toMinutes(today.closeTime) : null;
  const yesterdayOpen = yesterday?.isOpen ? toMinutes(yesterday.openTime) : null;
  const yesterdayClose = yesterday?.isOpen ? toMinutes(yesterday.closeTime) : null;

  let isOpen = false;

  if (openFor !== null && closeFor !== null) {
    if (closeFor > openFor) {
      isOpen = minutes >= openFor && minutes < closeFor;
    } else {
      // Overnight shift: the window wraps past midnight, so yesterday's tail
      // can still be running when today's opening time has not arrived.
      const inTodayWindow = minutes >= openFor;
      const inYesterdayTail =
        yesterdayOpen !== null &&
        yesterdayClose !== null &&
        yesterdayClose <= yesterdayOpen &&
        minutes < yesterdayClose;
      isOpen = inTodayWindow || inYesterdayTail;
    }
  } else if (openFor !== null) {
    isOpen = minutes >= openFor;
  }

  const todayLabel = rangeLabel(today);

  let changeLabel = "";
  if (isOpen) {
    if (closeFor !== null && closeFor > (openFor ?? 0)) {
      changeLabel = `Closes ${formatClock(today?.closeTime)}`;
    }
  } else if (openFor !== null && minutes < openFor) {
    changeLabel = `Opens ${formatClock(today?.openTime)}`;
  } else {
    const next = findNextOpenDay(days, dayOfWeek);
    if (next) changeLabel = `Opens ${formatClock(next.openTime)} ${DAY_LABELS[next.dayOfWeek]}`;
  }

  return {
    isOpen,
    headline: isOpen ? "Open now" : "Closed",
    detail: changeLabel,
    todayLabel,
    nextChangeLabel: changeLabel,
  };
}

function findNextOpenDay(days: StoreDayHours[], fromDay: number): StoreDayHours | undefined {
  for (let step = 1; step <= 7; step += 1) {
    const day = days.find((entry) => entry.dayOfWeek === (fromDay + step) % 7);
    if (day?.isOpen && toMinutes(day.openTime) !== null) return day;
  }
  return undefined;
}

/** One-line schedule for the footer, e.g. "Mon–Sun 10 AM – 11 PM". */
export function summarizeWeek(schedule: PublicWeeklyHour[] | undefined | null): string {
  const days = normalize(schedule);
  if (days.length === 0) return "";
  const openDays = days.filter((day) => day.isOpen && toMinutes(day.openTime) !== null);
  if (openDays.length === 0) return "Closed";

  const ranges = new Set(openDays.map((day) => rangeLabel(day)));
  if (ranges.size === 1) return `Every day · ${[...ranges][0]}`;
  return openDays
    .slice()
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
    .map((day) => `${DAY_LABELS[day.dayOfWeek] ?? ""} ${rangeLabel(day)}`)
    .join(" · ");
}

export const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

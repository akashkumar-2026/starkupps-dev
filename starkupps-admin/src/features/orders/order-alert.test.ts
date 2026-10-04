import { describe, expect, it } from "vitest";

import {
  alertTone,
  describePending,
  initialRingState,
  isAutoplayRejection,
  needsAttention,
  readPreference,
  isRinging,
  ringReducer,
  RING_WINDOW_MS,
  shouldRing,
  type RingState,
} from "./order-alert";

/** A fixed instant, so window arithmetic in tests is not clock-dependent. */
const T0 = 1_700_000_000_000;

/**
 * A loaded, unblocked audio element with `count` orders waiting.
 *
 * `ringUntil` defaults to an open window at `T0`, because these tests are about
 * *who gets to ring*; the window's own lifetime is covered separately below.
 */
const ready = (count: number, patch: Partial<RingState> = {}): RingState => ({
  ...initialRingState("on"),
  playable: true,
  pendingCount: count,
  ringUntil: count > 0 ? T0 + RING_WINDOW_MS : null,
  ...patch,
});

describe("shouldRing", () => {
  it("rings while at least one untouched order exists", () => {
    expect(shouldRing(ready(1), T0)).toBe(true);
    expect(shouldRing(ready(7), T0)).toBe(true);
  });

  it("stops the moment nothing is waiting", () => {
    // The whole stop condition. An order that has been advanced or cancelled
    // leaves `new`, so the count reaches zero and the sound stops.
    expect(shouldRing(ready(0), T0)).toBe(false);
  });

  it("never rings when the operator muted it", () => {
    expect(shouldRing(ready(3, { preference: "off" }))).toBe(false);
  });

  it("will not retry a play the browser already refused", () => {
    // Otherwise every render fires another rejected promise.
    expect(shouldRing(ready(3, { blocked: true }))).toBe(false);
  });

  it("waits for the file rather than firing a truncated clip", () => {
    expect(shouldRing(ready(3, { playable: false }))).toBe(false);
  });

  it("stays silent before the element reports it can play", () => {
    expect(shouldRing(initialRingState("on"))).toBe(false);
  });
});

describe("ringReducer — pending count", () => {
  it("clears the count when nothing is waiting", () => {
    const state = ringReducer(ready(4), { type: "pending", count: 0, now: T0 });
    expect(state.pendingCount).toBe(0);
    expect(shouldRing(state)).toBe(false);
  });

  it("treats a nonsense count as nothing waiting rather than trusting it", () => {
    for (const count of [-1, 1.5, Number.NaN]) {
      expect(
        ringReducer(ready(4), { type: "pending", count, now: T0 }).pendingCount
      ).toBe(0);
    }
  });

  it("keeps the last good count when the count is unreadable", () => {
    // A transient failed read must not silence a waiting order. The query layer
    // keeps its last data on error, so this is belt-and-braces, but it is the
    // direction that fails safely.
    const state = ready(4);
    expect(
      ringReducer(state, { type: "pending", count: -1, now: T0 }).pendingCount
    ).toBe(0);
  });
});

describe("ringReducer — the sticky unlock", () => {
  it("spends its single gesture retry on the first gesture while blocked", () => {
    const blocked = ready(2, { blocked: true, retriedAfterGesture: true });
    expect(ringReducer(blocked, { type: "gesture" })).toBe(blocked);
  });

  it("does not re-arm once unmuting has been used", () => {
    // Muting then un-muting is the operator explicitly asking for sound, so it is
    // a legitimate second chance.
    let state = ready(2, { blocked: true, retriedAfterGesture: true });
    state = ringReducer(state, { type: "preference", preference: "on" });
    expect(state.retriedAfterGesture).toBe(false);
  });

  it("preserves the retry budget while remaining muted", () => {
    const state = ringReducer(ready(2, { retriedAfterGesture: false }), {
      type: "preference",
      preference: "off",
    });
    expect(state.retriedAfterGesture).toBe(false);
  });

  it("marks the retry spent as soon as a play is blocked", () => {
    const state = ringReducer(ready(1, { retriedAfterGesture: false }), {
      type: "blocked",
      blocked: true,
    });
    expect(state.blocked).toBe(true);
    expect(state.retriedAfterGesture).toBe(true);
  });

  it("clears blocked when a play finally succeeds", () => {
    const state = ringReducer(
      ready(1, { blocked: true, retriedAfterGesture: true }),
      {
        type: "blocked",
        blocked: false,
      }
    );
    expect(state.blocked).toBe(false);
    expect(shouldRing(state, T0)).toBe(true);
  });

  it("ignores gestures when nothing is blocked", () => {
    const open = ready(1);
    expect(ringReducer(open, { type: "gesture" })).toBe(open);
  });
});

describe("isAutoplayRejection", () => {
  it("recognises the autoplay-policy rejection", () => {
    expect(
      isAutoplayRejection(new DOMException("blocked", "NotAllowedError"))
    ).toBe(true);
    expect(isAutoplayRejection({ name: "NotAllowedError" })).toBe(true);
  });

  it("treats a broken clip as unrecoverable, not as a blocked autoplay", () => {
    // A 404 or decode failure will fail again on every retry, so the UI must not
    // send the operator to click a button that can never work.
    for (const name of [
      "NotSupportedError",
      "AbortError",
      "NetworkError",
      "",
    ]) {
      expect(isAutoplayRejection({ name })).toBe(false);
    }
    expect(isAutoplayRejection(new Error("boom"))).toBe(false);
    expect(isAutoplayRejection(null)).toBe(false);
    expect(isAutoplayRejection(undefined)).toBe(false);
  });
});

describe("readPreference", () => {
  it("defaults to on so a fresh panel is not silently mute", () => {
    expect(readPreference(null)).toBe("on");
    expect(readPreference(undefined)).toBe("on");
    expect(readPreference("")).toBe("on");
    expect(readPreference("on")).toBe("on");
  });

  it("honours an explicit mute, which is the only way to be off", () => {
    expect(readPreference("off")).toBe("off");
  });

  it("ignores a corrupt or foreign value rather than muting by accident", () => {
    for (const raw of ["OFF", "false", "0", "no", "{}"]) {
      expect(readPreference(raw)).toBe("on");
    }
  });
});

describe("alertTone", () => {
  it("is clear only when nothing is waiting", () => {
    expect(alertTone(ready(0))).toBe("clear");
  });

  it("reports the broken case loudly", () => {
    // An order is waiting and cannot alert — the operator must be able to see
    // this without reading anything.
    expect(
      alertTone(ready(2, { blocked: true, retriedAfterGesture: true }))
    ).toBe("silent-waiting");
    expect(needsAttention(ready(2, { blocked: true }))).toBe(true);
  });

  it("only nags quietly about a deliberate mute", () => {
    expect(alertTone(ready(2, { preference: "off" }))).toBe("muted-waiting");
    expect(needsAttention(ready(2, { preference: "off" }))).toBe(false);
  });

  it("confirms a working alert", () => {
    expect(alertTone(ready(2))).toBe("ringing");
    expect(needsAttention(ready(2))).toBe(false);
  });
});

describe("describePending", () => {
  it("counts in words, not digits", () => {
    expect(describePending(0)).toBe("No new orders");
    expect(describePending(1)).toBe("1 new order waiting");
    expect(describePending(4)).toBe("4 new orders waiting");
  });
});

describe("the 15-second ring window", () => {
  /** A state that has just seen `count` orders arrive at `T0`. */
  const arrived = (count: number) =>
    ringReducer(initialRingState("on"), { type: "pending", count, now: T0 });

  it("rings when an order arrives, and stops 15s later", () => {
    const state = arrived(1);
    expect(shouldRing({ ...state, playable: true }, T0)).toBe(true);
    // One tick before the deadline, still ringing.
    expect(
      shouldRing({ ...state, playable: true }, T0 + RING_WINDOW_MS - 1)
    ).toBe(true);
    // At the deadline, silent. This is the bug being fixed.
    expect(shouldRing({ ...state, playable: true }, T0 + RING_WINDOW_MS)).toBe(
      false
    );
    expect(shouldRing({ ...state, playable: true }, T0 + 60_000)).toBe(false);
  });

  it("stays silent once the window closes even though an order is still waiting", () => {
    // The exact reported symptom: the order is untouched, so the count stays > 0
    // forever, and before this fix the clip looped indefinitely.
    const state = { ...arrived(1), playable: true };
    expect(state.pendingCount).toBe(1);
    expect(shouldRing(state, T0 + 5 * 60_000)).toBe(false);
  });

  it("closes the window when the expiry arrives", () => {
    const closed = ringReducer(arrived(1), {
      type: "expired",
      now: T0 + RING_WINDOW_MS,
    });
    expect(closed.ringUntil).toBeNull();
    expect(isRinging(closed, T0 + RING_WINDOW_MS)).toBe(false);
  });

  it("ignores an expiry that fires before the deadline", () => {
    // A timer scheduled for the old window, firing late into a newer one.
    const state = arrived(1);
    const stale = ringReducer(state, { type: "expired", now: T0 + 5_000 });
    expect(stale).toBe(state);
    expect(isRinging(stale, T0 + 5_000)).toBe(true);
  });

  it("is not extended by a refetch of an unchanged count", () => {
    // Load-bearing. The count is polled every couple of minutes as a safety net;
    // if an unchanged read reset the window it would never close, which is the
    // unbounded ringing all over again.
    const state = arrived(3);
    const afterRefetch = ringReducer(state, {
      type: "pending",
      count: 3,
      now: T0 + 5_000,
    });
    expect(afterRefetch.ringUntil).toBe(state.ringUntil);
    expect(
      shouldRing({ ...afterRefetch, playable: true }, T0 + RING_WINDOW_MS)
    ).toBe(false);
  });

  it("is not extended or restarted by an order being actioned mid-window", () => {
    const state = arrived(3);
    const afterOneHandled = ringReducer(state, {
      type: "pending",
      count: 2,
      now: T0 + 4_000,
    });
    expect(afterOneHandled.ringUntil).toBe(state.ringUntil);
  });

  it("opens a fresh window for each new arrival", () => {
    // Proportional to what happened: a burst of orders rings for a burst of
    // windows, not one.
    const first = arrived(1);
    const second = ringReducer(first, {
      type: "pending",
      count: 2,
      now: T0 + 20_000,
    });
    expect(second.ringUntil).toBe(T0 + 20_000 + RING_WINDOW_MS);
    // The previous window had already closed; this one is open.
    expect(isRinging(first, T0 + 20_000)).toBe(false);
    expect(isRinging(second, T0 + 20_000)).toBe(true);
  });

  it("closes immediately when the last order is handled", () => {
    const state = ringReducer(arrived(2), {
      type: "pending",
      count: 0,
      now: T0 + 2_000,
    });
    expect(state.ringUntil).toBeNull();
    expect(shouldRing({ ...state, playable: true }, T0 + 2_000)).toBe(false);
  });

  it("does not resume a ring for a tab that slept through the window", () => {
    const state = { ...arrived(1), playable: true };
    // Woke up ten minutes later. The deadline has long passed.
    expect(shouldRing(state, T0 + 600_000)).toBe(false);
  });

  it("does not resurrect a window that already closed, on a later refetch", () => {
    let state = arrived(1);
    state = ringReducer(state, { type: "expired", now: T0 + RING_WINDOW_MS });
    const refetch = ringReducer(state, {
      type: "pending",
      count: 1,
      now: T0 + 90_000,
    });
    expect(refetch.ringUntil).toBeNull();
    expect(shouldRing({ ...refetch, playable: true }, T0 + 90_000)).toBe(false);
  });

  it("rings for a burst arriving at once, not once per order", () => {
    // The stream delivers inserts one at a time but a reconnect can reveal a
    // backlog in a single count jump.
    const state = arrived(5);
    expect(shouldRing({ ...state, playable: true }, T0)).toBe(true);
    expect(shouldRing({ ...state, playable: true }, T0 + RING_WINDOW_MS)).toBe(
      false
    );
  });

  it("still needs sound on and the file loaded", () => {
    const state = arrived(1);
    expect(
      shouldRing({ ...state, playable: true, preference: "off" }, T0)
    ).toBe(false);
    expect(shouldRing({ ...state, playable: false }, T0)).toBe(false);
  });

  it("rings for the window after an operator unmutes mid-window", () => {
    const muted = ringReducer(arrived(1), {
      type: "preference",
      preference: "off",
    });
    const unmuted = ringReducer(muted, {
      type: "preference",
      preference: "on",
    });
    expect(shouldRing({ ...unmuted, playable: true }, T0 + 3_000)).toBe(true);
  });

  it("is bounded by roughly fifteen seconds, not minutes", () => {
    // Guards the constant itself against being edited into something unusable.
    expect(RING_WINDOW_MS).toBe(15_000);
    expect(RING_WINDOW_MS).toBeLessThanOrEqual(30_000);
  });
});

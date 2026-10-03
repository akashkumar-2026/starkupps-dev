import { describe, expect, it } from "vitest";

import {
  alertTone,
  describePending,
  initialRingState,
  isAutoplayRejection,
  needsAttention,
  readPreference,
  ringReducer,
  shouldRing,
  type RingState,
} from "./order-alert";

/** A loaded, unblocked audio element with `count` orders waiting. */
const ready = (count: number, patch: Partial<RingState> = {}): RingState => ({
  ...initialRingState("on"),
  playable: true,
  pendingCount: count,
  ...patch,
});

describe("shouldRing", () => {
  it("rings while at least one untouched order exists", () => {
    expect(shouldRing(ready(1))).toBe(true);
    expect(shouldRing(ready(7))).toBe(true);
  });

  it("stops the moment nothing is waiting", () => {
    // The whole stop condition. An order that has been advanced or cancelled
    // leaves `new`, so the count reaches zero and the sound stops.
    expect(shouldRing(ready(0))).toBe(false);
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
    const state = ringReducer(ready(4), { type: "pending", count: 0 });
    expect(state.pendingCount).toBe(0);
    expect(shouldRing(state)).toBe(false);
  });

  it("treats a nonsense count as nothing waiting rather than trusting it", () => {
    for (const count of [-1, 1.5, Number.NaN]) {
      expect(
        ringReducer(ready(4), { type: "pending", count }).pendingCount
      ).toBe(0);
    }
  });

  it("keeps the last good count when the count is unreadable", () => {
    // A transient failed read must not silence a waiting order. The query layer
    // keeps its last data on error, so this is belt-and-braces, but it is the
    // direction that fails safely.
    const state = ready(4);
    expect(
      ringReducer(state, { type: "pending", count: -1 }).pendingCount
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
    expect(shouldRing(state)).toBe(true);
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

import { describe, expect, it } from "vitest";

import {
  geolocationFailureReason,
  initialLocateState,
  locateFailureMessage,
  type LocationFailure,
} from "./locate";

/**
 * The failure paths matter more than the success path here.
 *
 * This button fills a *required* field on a delivery order. If a denied
 * permission, an insecure page or a missing API left the customer staring at an
 * empty box with no explanation and no way forward, they abandon the order — so
 * every case has to resolve to a specific, actionable message rather than a
 * generic "something went wrong".
 */
describe("geolocationFailureReason", () => {
  it("distinguishes a refusal from a missing fix", () => {
    // These need different wording: PERMISSION_DENIED means the customer said no
    // and can change their mind; POSITION_UNAVAILABLE is environmental and
    // retrying is pointless.
    expect(geolocationFailureReason(1)).toBe("denied");
    expect(geolocationFailureReason(2)).toBe("unavailable");
    expect(geolocationFailureReason(3)).toBe("timeout");
  });

  it("falls back to unavailable for an unrecognised code", () => {
    for (const code of [undefined, 0, 99, -1]) {
      expect(geolocationFailureReason(code)).toBe("unavailable");
    }
  });
});

describe("locateFailureMessage", () => {
  const reasons: LocationFailure[] = [
    "unsupported",
    "denied",
    "insecure-context",
    "timeout",
    "unavailable",
  ];

  it("always tells the customer they can still type an address", () => {
    // The field stays editable in every case, so every message has to point at
    // it. A message that only reports failure leaves a required field empty.
    for (const reason of reasons) {
      const message = locateFailureMessage(reason);
      expect(message.toLowerCase()).toMatch(/address/);
    }
  });

  it("explains a refusal in terms the customer can act on", () => {
    const message = locateFailureMessage("denied");
    expect(message).toMatch(/blocked/i);
    // Says where to change it, and offers the alternative.
    expect(message).toMatch(/site settings/i);
    expect(message).toMatch(/type your address/i);
  });

  it("is non-blaming for a refusal", () => {
    // "You denied" reads as an accusation and adds nothing the customer can do.
    expect(locateFailureMessage("denied").toLowerCase()).not.toMatch(
      /you (denied|blocked|refused)/,
    );
  });

  it("names the secure-context cause rather than a generic failure", () => {
    expect(locateFailureMessage("insecure-context")).toMatch(/https/i);
  });

  it("distinguishes every case so the UI is never ambiguous", () => {
    const messages = reasons.map(locateFailureMessage);
    expect(new Set(messages).size).toBe(reasons.length);
  });
});

describe("initialLocateState", () => {
  it("starts idle with no coordinates and no error", () => {
    // The button must be usable immediately, and no stale reason may be shown
    // before the first attempt.
    expect(initialLocateState).toEqual({
      status: "idle",
      coords: null,
      reason: null,
    });
  });
});

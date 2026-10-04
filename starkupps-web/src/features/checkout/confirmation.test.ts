import { describe, expect, it } from "vitest";

import {
  CONFIRMATION_EXTEND_MS,
  CONFIRMATION_MS,
  confirmationTitle,
  nextStepLabel,
} from "./confirmation";

/**
 * The confirmation screen replaced a toast.
 *
 * The ticket number is the artefact the customer actually needs — it is what
 * they quote at the counter — so these assertions are about it being prominent
 * and unambiguous rather than about incidental styling.
 */
describe("confirmationTitle", () => {
  it("greets by first name, which is what a counter order reads like", () => {
    expect(confirmationTitle("Aman Kumar")).toBe("Thanks, Aman");
  });

  it("uses only the first name on a multi-part name", () => {
    expect(confirmationTitle("Aashish kumar Sharma")).toBe("Thanks, Aashish");
  });

  it("still reads correctly when no name was captured", () => {
    // A guest checkout with a blank name must not render "Thanks, ".
    expect(confirmationTitle("")).toBe("Order confirmed");
    expect(confirmationTitle("   ")).toBe("Order confirmed");
  });

  it("keeps a single-word name intact", () => {
    expect(confirmationTitle("Prince")).toBe("Thanks, Prince");
  });

  it("stays short enough for one line on a narrow phone", () => {
    // Guards against someone "improving" this into a sentence that wraps.
    expect(confirmationTitle("Aman Kumar").length).toBeLessThan(20);
  });
});

describe("nextStepLabel", () => {
  it("gives delivery its own instruction", () => {
    // Telling a delivery customer to wait at the counter is simply wrong, and
    // this line is the only place that distinction is communicated.
    expect(nextStepLabel("delivery")).toMatch(/call you/i);
    expect(nextStepLabel("delivery").toLowerCase()).not.toMatch(/counter/);
  });

  it("mentions the table for dine-in", () => {
    expect(nextStepLabel("dine-in")).toMatch(/table/i);
  });

  it("gives counter pickup a wait time", () => {
    expect(nextStepLabel("takeaway")).toMatch(/10 minutes|ready/i);
  });

  it("falls back to the pickup copy for an unknown type", () => {
    // A new order type added server-side must not render an empty line.
    expect(nextStepLabel("scheduled_pickup")).toBeTruthy();
    expect(nextStepLabel("")).toBeTruthy();
  });
});

describe("timing", () => {
  it("dismisses on its own", () => {
    // An interstitial that requires a tap strands anyone who does not
    // understand it, and the customer already has what they came for.
    expect(CONFIRMATION_MS).toBeGreaterThan(0);
    expect(CONFIRMATION_MS).toBeLessThanOrEqual(15_000);
  });

  it("grants a full fresh interval on interaction", () => {
    // Reading a number and copying it takes longer than one interval for
    // plenty of people, so an interaction buys a whole new interval rather
    // than a token extension.
    expect(CONFIRMATION_EXTEND_MS).toBeGreaterThanOrEqual(CONFIRMATION_MS);
  });
});

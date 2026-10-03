import { describe, expect, it } from "vitest";

import {
  canTransitionOrderStatus,
  isOrderStatus,
  ORDER_STATUS_TRANSITIONS,
  TERMINAL_ORDER_STATUSES,
} from "./orderStatus";

/**
 * The rules `admin.orders.updateStatus` enforces.
 *
 * These matter because revenue reporting (`admin.dashboard`,
 * `analytics.overview`) counts `status = 'completed'`. Before the transition
 * table existed, the only server-side rule was "not already closed", so
 * `new -> completed` succeeded over the API even though the queue UI never
 * offered it — which is how an order could be reported as served before it was
 * ever made.
 */
describe("order status transitions", () => {
  it("follows the documented happy path", () => {
    expect(canTransitionOrderStatus("new", "preparing")).toBe(true);
    expect(canTransitionOrderStatus("preparing", "ready")).toBe(true);
    expect(canTransitionOrderStatus("ready", "completed")).toBe(true);
  });

  it("allows cancellation from any open status", () => {
    for (const status of ["new", "preparing", "ready"] as const) {
      expect(canTransitionOrderStatus(status, "cancelled")).toBe(true);
    }
  });

  it("treats completed and cancelled as terminal", () => {
    for (const status of TERMINAL_ORDER_STATUSES) {
      expect(ORDER_STATUS_TRANSITIONS[status]).toHaveLength(0);
      for (const target of [
        "new",
        "preparing",
        "ready",
        "completed",
        "cancelled",
      ]) {
        expect(canTransitionOrderStatus(status, target)).toBe(false);
      }
    }
  });

  it("refuses to skip preparation, the defect that reported phantom revenue", () => {
    expect(canTransitionOrderStatus("new", "completed")).toBe(false);
    expect(canTransitionOrderStatus("new", "ready")).toBe(false);
    expect(canTransitionOrderStatus("preparing", "completed")).toBe(false);
  });

  it("refuses to move backwards", () => {
    expect(canTransitionOrderStatus("ready", "new")).toBe(false);
    expect(canTransitionOrderStatus("preparing", "new")).toBe(false);
  });

  it("refuses unrecognised states rather than defaulting to allowed", () => {
    // A row written by an older deploy, or hand-edited, must not be able to
    // satisfy an arbitrary transition by falling through an empty lookup.
    expect(isOrderStatus("dispatched")).toBe(false);
    expect(canTransitionOrderStatus("dispatched", "completed")).toBe(false);
    expect(canTransitionOrderStatus("new", "dispatched")).toBe(false);
    expect(canTransitionOrderStatus(null, "completed")).toBe(false);
    expect(canTransitionOrderStatus("new", null)).toBe(false);
  });

  it("rejects self-transitions so the caller handles them as idempotent no-ops", () => {
    // Deliberately false: `updateStatus` checks `current !== input.status`
    // before consulting this table, so a double-click is a no-op rather than an
    // error. Keeping it false here stops the table being read as "any change to
    // the same value is a legal transition".
    for (const status of ["new", "preparing", "ready"] as const) {
      expect(canTransitionOrderStatus(status, status)).toBe(false);
    }
  });
});

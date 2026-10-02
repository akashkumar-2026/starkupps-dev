import { describe, expect, it } from "vitest";
import { roleCan } from "@shared/permissions";
import {
  buildOutletDeleteImpact,
  compactImpactRows,
  OPEN_DELIVERY_STATUSES,
  OPEN_ORDER_STATUSES,
  OUTLET_DETACH_TABLES,
  OUTLET_PURGE_TABLES,
  outletDeleteDetachLabel,
  outletDeletePurgeLabel,
} from "../routers/outletDeletion";
import type { OutletPurgeTable } from "../routers/outletDeletion";

// Deliberately does not import `../routers`: that pulls in the `argon2` native
// binding, which segfaults this Node build and takes the whole vitest worker
// with it. The permission matrix below is the same gate `outlets.delete`
// enforces via `requirePerm(ctx.user, "outlets.delete")`.

describe("outlets.delete authorization", () => {
  it("is owner-only", () => {
    expect(roleCan("owner", "outlets.delete")).toBe(true);
    expect(roleCan("manager", "outlets.delete")).toBe(false);
    expect(roleCan("staff", "outlets.delete")).toBe(false);
  });

  it("leaves managers able to update outlets so they can deactivate instead", () => {
    expect(roleCan("manager", "outlets.update")).toBe(true);
    expect(roleCan("manager", "outlets.create")).toBe(false);
  });

  it("denies unknown roles", () => {
    expect(roleCan(null, "outlets.delete")).toBe(false);
  });
});

describe("outlet deletion dependency map", () => {
  it("has no duplicate purge tables", () => {
    expect(new Set(OUTLET_PURGE_TABLES).size).toBe(OUTLET_PURGE_TABLES.length);
  });

  it("never purges a table it also detaches", () => {
    const detach = new Set<string>(OUTLET_DETACH_TABLES);
    for (const table of OUTLET_PURGE_TABLES) {
      expect(detach.has(table)).toBe(false);
    }
  });

  it("labels every purge and detach table for the confirmation dialog", () => {
    for (const table of OUTLET_PURGE_TABLES) {
      expect(outletDeletePurgeLabel(table)).toBeTruthy();
    }
    for (const table of OUTLET_DETACH_TABLES) {
      expect(outletDeleteDetachLabel(table)).toBeTruthy();
    }
  });

  it("refuses to report an unlabelled table rather than rendering a blank row", () => {
    expect(() => outletDeletePurgeLabel("some_future_table")).toThrow(
      /missing label/
    );
  });

  it("purges dependent rows before the parents they reference", () => {
    const at = (table: OutletPurgeTable) => OUTLET_PURGE_TABLES.indexOf(table);
    // deliveries cascades from orders, coupon_redemptions from orders and
    // customers, and staff_schedules from staff — all of which the delete
    // keeps, so those children must be removed explicitly and first.
    const children: OutletPurgeTable[] = [
      "coupon_redemptions",
      "customer_feedback",
      "support_tickets",
      "deliveries",
      "attendance_records",
      "leave_requests",
      "staff_schedules",
    ];
    for (const child of children) {
      expect(at(child)).toBeGreaterThanOrEqual(0);
    }
    expect(at("outlet_hours")).toBeGreaterThan(at("deliveries"));
    expect(at("delivery_zones")).toBeGreaterThan(at("outlet_closures"));
  });
});

describe("outlet delete blockers", () => {
  it("treats every non-terminal order status as in progress", () => {
    expect([...OPEN_ORDER_STATUSES]).toEqual(["new", "preparing", "ready"]);
    expect(OPEN_ORDER_STATUSES).not.toContain("completed");
    expect(OPEN_ORDER_STATUSES).not.toContain("cancelled");
  });

  it("treats every non-terminal delivery status as in flight", () => {
    expect(OPEN_DELIVERY_STATUSES).not.toContain("delivered");
    expect(OPEN_DELIVERY_STATUSES).not.toContain("cancelled");
    expect(OPEN_DELIVERY_STATUSES).not.toContain("failed");
    expect(OPEN_DELIVERY_STATUSES).toContain("out_for_delivery");
  });

  it("blocks on open orders", () => {
    const impact = buildOutletDeleteImpact({
      counts: {},
      openOrders: 1,
      openDeliveries: 0,
    });
    expect(impact.deletable).toBe(false);
    expect(impact.blockers).toHaveLength(1);
    expect(impact.blockers[0]).toBe(
      "1 order is still in progress. Complete or cancel it first."
    );
  });

  it("blocks on in-flight deliveries", () => {
    const impact = buildOutletDeleteImpact({
      counts: {},
      openOrders: 0,
      openDeliveries: 3,
    });
    expect(impact.deletable).toBe(false);
    expect(impact.blockers[0]).toMatch(/^3 deliveries are still in flight\./);
  });

  it("reports both blockers together rather than only the first", () => {
    const impact = buildOutletDeleteImpact({
      counts: {},
      openOrders: 2,
      openDeliveries: 1,
    });
    expect(impact.blockers).toHaveLength(2);
    expect(impact.blockers[0]).toMatch(/^2 orders are still in progress\./);
  });

  it("allows the delete when no work is outstanding", () => {
    const impact = buildOutletDeleteImpact({
      counts: { outlet_hours: 7 },
      openOrders: 0,
      openDeliveries: 0,
    });
    expect(impact.deletable).toBe(true);
    expect(impact.blockers).toEqual([]);
    expect(impact.totalPurged).toBe(7);
  });
});

describe("outlet delete impact report", () => {
  it("drops zero rows so the dialog shows only what changes", () => {
    const impact = buildOutletDeleteImpact({
      counts: { outlet_hours: 7, riders: 0, orders: 4 },
      openOrders: 0,
      openDeliveries: 0,
    });
    expect(impact.purged.map(r => r.table)).toEqual(["outlet_hours"]);
    expect(impact.detached.map(r => r.table)).toEqual(["orders"]);
    expect(impact.totalPurged).toBe(7);
  });

  it("counts staff whose primary outlet link will be cleared", () => {
    const impact = buildOutletDeleteImpact({
      counts: { staff: 2 },
      openOrders: 0,
      openDeliveries: 0,
    });
    expect(impact.unassignedStaff.count).toBe(2);
    // Cleared links are not destroyed rows, so they stay out of the headline.
    expect(impact.totalPurged).toBe(0);
  });

  it("coerces Postgres bigint counts to numbers", () => {
    const impact = buildOutletDeleteImpact({
      counts: { outlet_hours: "7" as unknown as number },
      openOrders: 0,
      openDeliveries: 0,
    });
    expect(impact.totalPurged).toBe(7);
    expect(typeof impact.totalPurged).toBe("number");
  });

  it("exposes blocker counts separately so they never render as a purge row", () => {
    const impact = buildOutletDeleteImpact({
      counts: { __openOrders: 4 },
      openOrders: 4,
      openDeliveries: 0,
    });
    expect(impact.purged.map(r => r.table)).not.toContain("__openOrders");
    expect(impact.totalPurged).toBe(0);
  });

  it("compacts zero-count rows", () => {
    expect(
      compactImpactRows([
        { table: "a", label: "A", count: 0 },
        { table: "b", label: "B", count: 2 },
      ]).map(r => r.table)
    ).toEqual(["b"]);
  });
});

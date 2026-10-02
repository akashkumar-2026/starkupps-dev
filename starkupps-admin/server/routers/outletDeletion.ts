/**
 * Deletion contract for `outlets`.
 *
 * Deleting an outlet is the only destructive operation in the panel that can
 * touch ~27 tables, and most of them have **no foreign key** to `outlets` (the
 * schema hardens `orders`, `outlet_staff`, `outlet_variant_availability` and
 * `staff.primaryOutletId` only). A bare `DELETE FROM outlets` therefore
 * succeeds while silently orphaning hours, zones, inventory, riders and
 * schedules — rows nothing will ever clean up, and nothing that can report
 * them.
 *
 * So the map below is the single source of truth for what a delete touches,
 * and both the preflight (`outlets.deleteImpact`) and the mutation
 * (`outlets.delete`) read from it. Adding a table in a future migration means
 * adding it here too, in exactly one place.
 */

/** Row sets destroyed outright. Ordered leaf-first: a table that is
 *  `ON DELETE CASCADE`-referenced by another entry must come *before* it. */
export const OUTLET_PURGE_TABLES = [
  // Children of `orders` / `customers` / `staff`, so they go before anything
  // they point at and never rely on a cascade we do not control.
  "coupon_redemptions",
  "customer_feedback",
  "support_tickets",
  "deliveries",
  "attendance_records",
  "leave_requests",
  "staff_schedules",
  "outlet_menu_availability",
  "outlet_variant_availability",
  "outlet_closures",
  "outlet_hours",
  "delivery_zones",
  "outlet_staff",
  "prepared_item_batches",
  "prepared_items",
  "inventory_items",
  "recipes",
  "wastage_records",
  "riders",
  "shift_templates",
] as const;

/** Financial history. Never destroyed — the `outletId` is detached so the
 *  order/payment/expense records stay auditable and reportable, exactly as
 *  `orders_outlet_fk` (`ON DELETE SET NULL`) already does for orders. */
export const OUTLET_DETACH_TABLES = [
  "orders",
  "payments",
  "expenses",
  "payouts",
  "taxes",
] as const;

/** The audit trail outlives the entity it describes. Rows keep
 *  `entityType = 'outlet'` / `entityId`, so detaching `outletId` removes the
 *  dangling reference without erasing the forensic record. */
export const OUTLET_AUDIT_TABLES = ["audit_log"] as const;

/** `staff` is special-cased: `primaryOutletId` is a `SET NULL` FK, but the
 *  affected staff rows are read first so their authorization memos can be
 *  invalidated in the same request (otherwise a removed manager keeps
 *  outlet-scoped access for up to the memo TTL). */
export const OUTLET_PRIMARY_OWNER_TABLE = "staff";

/** Order statuses with work still attached. Destroying these would orphan
 *  live tickets and kitchen/POS state. */
export const OPEN_ORDER_STATUSES = ["new", "preparing", "ready"] as const;

/** Delivery statuses with work still attached. */
export const OPEN_DELIVERY_STATUSES = [
  "preparing",
  "ready",
  "rider_assigned",
  "picked_up",
  "out_for_delivery",
] as const;

export type OutletPurgeTable = (typeof OUTLET_PURGE_TABLES)[number];
export type OutletDetachTable = (typeof OUTLET_DETACH_TABLES)[number];
export type OutletAuditTable = (typeof OUTLET_AUDIT_TABLES)[number];

export interface OutletDeleteImpactRow {
  table: string;
  label: string;
  count: number;
}

export interface OutletDeleteImpact {
  /** Every dependent row count, purge entries first. */
  purged: OutletDeleteImpactRow[];
  /** Financial history kept, but no longer attributed to an outlet. */
  detached: OutletDeleteImpactRow[];
  /** Staff whose `primaryOutletId` is cleared. */
  unassignedStaff: OutletDeleteImpactRow;
  /** Everything that stops the delete, already phrased for the operator. */
  blockers: string[];
  /** True when nothing blocks the delete. */
  deletable: boolean;
  /** Total rows destroyed, for the confirmation headline. */
  totalPurged: number;
}

/** Row of the `outlets` snapshot captured under `SELECT … FOR UPDATE` and
 *  written to the audit log as the `before` payload. */
export type OutletSnapshot = Record<string, unknown>;

/**
 * What the delete transaction returns. Annotated explicitly because
 * `postgres.js` types `sql.begin` as `Promise<any>` — without this the router
 * output type would degrade to `any` and the client's toast copy would lose
 * its compile-time guarantees.
 */
export interface OutletDeleteTxResult {
  outlet: OutletSnapshot;
  purged: Record<string, number>;
  detached: Record<string, number>;
  impact: OutletDeleteImpact;
  /** Staff users who lose outlet access; their auth memos are invalidated. */
  affectedUsers: number[];
}

/** Human labels for the confirmation dialog. Keys must cover every table in
 *  the three lists above; `outletDeleteImpactTableLabel` is the single lookup
 *  so a new table cannot ship without a label. */
const PURGE_LABELS: Record<string, string> = {
  coupon_redemptions: "Coupon redemptions",
  customer_feedback: "Customer feedback",
  support_tickets: "Support tickets",
  deliveries: "Deliveries",
  attendance_records: "Attendance records",
  leave_requests: "Leave requests",
  staff_schedules: "Shift schedules",
  outlet_menu_availability: "Menu availability overrides",
  outlet_variant_availability: "Variant availability overrides",
  outlet_closures: "Closure dates",
  outlet_hours: "Opening hours",
  delivery_zones: "Delivery zones",
  outlet_staff: "Staff assignments",
  prepared_item_batches: "Prepared-item batches",
  prepared_items: "Prepared items",
  inventory_items: "Inventory items",
  recipes: "Recipes",
  wastage_records: "Wastage records",
  riders: "Riders",
  shift_templates: "Shift templates",
};

const DETACH_LABELS: Record<string, string> = {
  orders: "Orders",
  payments: "Payments",
  expenses: "Expenses",
  payouts: "Payouts",
  taxes: "Tax records",
};

function label(labels: Record<string, string>, table: string): string {
  const found = labels[table];
  if (!found) throw new Error(`outletDeletion: missing label for ${table}`);
  return found;
}

export function outletDeletePurgeLabel(table: string): string {
  return label(PURGE_LABELS, table);
}

export function outletDeleteDetachLabel(table: string): string {
  return label(DETACH_LABELS, table);
}

/** Drops zero rows so the dialog shows only what actually changes. */
export function compactImpactRows(
  rows: OutletDeleteImpactRow[]
): OutletDeleteImpactRow[] {
  return rows.filter(r => r.count > 0);
}

export function buildOutletDeleteImpact(input: {
  counts: Record<string, number>;
  openOrders: number;
  openDeliveries: number;
}): OutletDeleteImpact {
  const { counts, openOrders, openDeliveries } = input;
  const blockers: string[] = [];
  if (openOrders > 0) {
    const plural = openOrders !== 1;
    blockers.push(
      `${openOrders} order${plural ? "s" : ""} ${plural ? "are" : "is"} still in progress. Complete or cancel ${plural ? "them" : "it"} first.`
    );
  }
  if (openDeliveries > 0) {
    const plural = openDeliveries !== 1;
    blockers.push(
      `${openDeliveries} deliver${plural ? "ies are" : "y is"} still in flight. Let ${plural ? "them" : "it"} complete or cancel first.`
    );
  }
  const purged = compactImpactRows(
    OUTLET_PURGE_TABLES.map(table => ({
      table,
      label: outletDeletePurgeLabel(table),
      count: Number(counts[table] ?? 0),
    }))
  );
  const detached = compactImpactRows(
    OUTLET_DETACH_TABLES.map(table => ({
      table,
      label: outletDeleteDetachLabel(table),
      count: Number(counts[table] ?? 0),
    }))
  );
  return {
    purged,
    detached,
    unassignedStaff: {
      table: OUTLET_PRIMARY_OWNER_TABLE,
      label: "Staff primary outlet links",
      count: Number(counts[OUTLET_PRIMARY_OWNER_TABLE] ?? 0),
    },
    blockers,
    deletable: blockers.length === 0,
    totalPurged: purged.reduce((sum, r) => sum + r.count, 0),
  };
}

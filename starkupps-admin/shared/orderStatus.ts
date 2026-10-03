/**
 * The order ticket lifecycle, and the legal moves between states.
 *
 * ## Why this lives server-side
 *
 * `admin.orders.updateStatus` used to enforce only "the ticket is not already
 * completed or cancelled". Any other transition was accepted, so `new ->
 * completed` — an order marked served before it was ever made — went through the
 * API even though the queue UI never offers that button. That matters because
 * `admin.dashboard` and `analytics.overview` both compute revenue and prep time
 * off `status = 'completed'`: an out-of-order write silently inflates them.
 *
 * The buttons in `src/features/orders/order-ui.ts` encode the same progression,
 * but a UI is not a control. Anything that can reach the endpoint — a stale open
 * tab, a replayed mutation, `fetch` in the console, a future integration — must
 * be held to the same rules, so the rules live here and the server enforces them.
 *
 * ## Shape of the rules
 *
 * `cancelled` is reachable from any *open* status, because a customer can call
 * off at any point and the operator has to be able to record that. `completed` is
 * reachable only from `ready`, and both `completed` and `cancelled` are terminal.
 *
 * Re-submitting the status a ticket already has is deliberately *not* in this
 * table and is handled by the caller as a no-op, so a double-click or a client
 * retry is idempotent rather than an error.
 *
 * `isOrderStatus` is the runtime guard for values that arrived as `any` — from
 * PostgREST's `select("*")`, whose `status` is typed `string`, not the union.
 */
export const ORDER_STATUSES = [
  "new",
  "preparing",
  "ready",
  "completed",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Human-readable labels, shared by the error copy and the Admin queue. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  new: "New",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Statuses that still represent live work. A closed ticket is neither. */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = [
  "new",
  "preparing",
  "ready",
];

/** Statuses that can no longer change. */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  "completed",
  "cancelled",
];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === "string" &&
    (ORDER_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * The single transition table. `ORDER_STATUS_TRANSITIONS[s]` lists every status
 * an open ticket in state `s` may legally move to.
 *
 * Linear progression (`new -> preparing -> ready -> completed`) with cancellation
 * available from any open state.
 */
export const ORDER_STATUS_TRANSITIONS: Record<
  OrderStatus,
  readonly OrderStatus[]
> = {
  new: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/** True when `from -> to` is a legal move. */
export function canTransitionOrderStatus(from: unknown, to: unknown): boolean {
  if (!isOrderStatus(from) || !isOrderStatus(to)) return false;
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

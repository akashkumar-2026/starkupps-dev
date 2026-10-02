import type { RealtimeChannel } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "./db/supabase";

// Server-brokered realtime relay.
//
// Why this exists: operational tables (orders, deliveries) are deny-by-default
// under RLS, so browsers cannot subscribe to them directly with the anon key.
// Instead the gateway — which uses the service-role client and bypasses RLS —
// holds the `postgres_changes` subscriptions and fans events out to
// authenticated SSE connections (/api/stream/admin) and token-gated order
// tracking streams (/api/public/orders/stream).
//
// Clients must still treat SSE as best-effort (polling remains the fallback),
// so a relay restart is recoverable rather than fatal.

/**
 * Tables the relay forwards.
 *
 * `orders` and `deliveries` are operational and outlet-scoped. The menu and
 * storefront tables are relayed so the admin panel reflects a price or
 * availability change immediately, and so the dashboard counters do not wait for
 * the next poll.
 */
export const RELAY_TABLES = [
  "orders",
  "deliveries",
  "menu_items",
  "menu_categories",
  "menu_item_variants",
  "outlet_menu_availability",
  "outlet_variant_availability",
  "site_settings",
  "testimonials",
] as const;

/**
 * ONE CHANNEL PER TABLE — not one channel with many bindings.
 *
 * Measured against this project (probe: same channel, N `postgres_changes`
 * bindings, one write to `menu_items`):
 *
 *   bindings  SUBSCRIBED   events delivered
 *        1-2  yes          0 (target table not bound)
 *        3-8  yes          1
 *        9    yes          0      <-- silent failure
 *
 * Past 8 bindings the channel still reports SUBSCRIBED and delivers nothing, for
 * every table. This is why the relay appeared healthy in `/api/health` while no
 * order or menu event ever reached a browser: the status check only proved the
 * socket was open, not that events were flowing.
 *
 * Splitting into per-table channels keeps every binding well inside the limit
 * and isolates the blast radius: if one channel dies, only that table's stream
 * is affected.
 */
export type ChangeTable = (typeof RELAY_TABLES)[number];
export type ChangeEvent = {
  table: ChangeTable;
  event: "INSERT" | "UPDATE" | "DELETE";
  id: number;
  outletId: number | null;
  status: string | null;
  orderNumber: number | null;
  /** Row key set on INSERT/UPDATE so a client can patch its cached row. */
  keys: Record<string, unknown> | null;
};

/** Outlet-scoped topics. Everything else is broadcast globally. */
const OUTLET_SCOPED: ReadonlySet<string> = new Set(["orders", "deliveries"]);

type Send = (ev: ChangeEvent) => void;

const orderWatchers = new Map<number, Set<Send>>();
const tableWatchers = new Map<string, Set<Send>>(); // `${table}:${outletId}` or `${table}:*`

const channels = new Map<ChangeTable, RealtimeChannel>();
/** Tables whose channel has reported a live SUBSCRIBED. */
const subscribed = new Set<ChangeTable>();
let retryDelayMs = 1_000;
const retryTimers = new Map<ChangeTable, ReturnType<typeof setTimeout>>();

export function hubStatus() {
  return {
    started: channels.size > 0,
    subscribeStatus:
      subscribed.size === channels.size ? "SUBSCRIBED" : "SUBSCRIBING",
    tables: RELAY_TABLES.length,
    /** Tables currently delivering events. Fewer than `tables` means degraded. */
    live: subscribed.size,
    orderWatchers: orderWatchers.size,
    tableWatchers: tableWatchers.size,
  };
}

function emit(ev: ChangeEvent) {
  if (OUTLET_SCOPED.has(ev.table)) {
    const direct = orderWatchers.get(ev.id);
    if (direct) for (const send of Array.from(direct)) safeSend(send, ev);
    if (ev.outletId != null) {
      const scoped = tableWatchers.get(`${ev.table}:${ev.outletId}`);
      if (scoped) for (const send of Array.from(scoped)) safeSend(send, ev);
    }
  }
  const all = tableWatchers.get(`${ev.table}:*`);
  if (all) for (const send of Array.from(all)) safeSend(send, ev);
}

function safeSend(send: Send, ev: ChangeEvent) {
  try {
    send(ev);
  } catch {}
}

function toEvent(table: ChangeTable, payload: any): ChangeEvent | null {
  const event = String(payload?.eventType ?? "").toUpperCase();
  if (event !== "INSERT" && event !== "UPDATE" && event !== "DELETE")
    return null;
  // Prefer `new`, but a DELETE only populates `old`. Both tables now carry
  // REPLICA IDENTITY FULL, so either side has the columns we need.
  const row = (payload?.new ?? payload?.old ?? {}) as any;
  const id = Number(row?.id);
  if (!Number.isInteger(id)) return null;
  const outletId = row?.outletId == null ? null : Number(row.outletId);
  return {
    table,
    event: event as ChangeEvent["event"],
    id,
    outletId: outletId != null && Number.isInteger(outletId) ? outletId : null,
    status: typeof row?.status === "string" ? row.status : null,
    orderNumber: row?.orderNumber != null ? Number(row.orderNumber) : null,
    keys: event === "DELETE" ? null : (row as Record<string, unknown>),
  };
}

function scheduleRetry(table: ChangeTable) {
  if (retryTimers.has(table)) return;
  const delay = retryDelayMs;
  retryDelayMs = Math.min(30_000, retryDelayMs * 2);
  const timer = setTimeout(() => {
    retryTimers.delete(table);
    startTable(table);
  }, delay);
  timer.unref?.();
  retryTimers.set(table, timer);
}

/** Open (or reopen) the channel for a single table. */
function startTable(table: ChangeTable) {
  const existing = channels.get(table);
  if (existing) {
    try {
      existing.unsubscribe();
    } catch {}
    channels.delete(table);
  }
  try {
    const supabase = getSupabaseAdmin();
    const ch = supabase.channel(`gateway-relay:${table}`);
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      (payload: any) => {
        const ev = toEvent(table, payload);
        if (ev) emit(ev);
      }
    );
    ch.subscribe((status: string) => {
      if (status === "SUBSCRIBED") {
        subscribed.add(table);
        retryDelayMs = 1_000;
        return;
      }
      subscribed.delete(table);
      // CLOSED is expected during teardown; the other two warrant a retry.
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn(`[realtime] ${table} channel ${status}`);
        scheduleRetry(table);
      }
    });
    channels.set(table, ch);
  } catch (e) {
    subscribed.delete(table);
    console.warn(
      `[realtime] ${table} channel failed to start:`,
      (e as Error)?.message ?? e
    );
    scheduleRetry(table);
  }
}

/** Idempotent: safe to call from every watcher. */
export function ensureHubStarted() {
  for (const table of RELAY_TABLES) {
    if (!channels.has(table)) startTable(table);
  }
}

export function watchOrder(orderId: number, send: Send): () => void {
  ensureHubStarted();
  let set = orderWatchers.get(orderId);
  if (!set) {
    set = new Set();
    orderWatchers.set(orderId, set);
  }
  set.add(send);
  return () => {
    const s = orderWatchers.get(orderId);
    if (!s) return;
    s.delete(send);
    if (s.size === 0) orderWatchers.delete(orderId);
  };
}

export function watchOutlet(
  table: ChangeTable,
  outletId: number | "*",
  send: Send
): () => void {
  ensureHubStarted();
  const key = `${table}:${outletId}`;
  let set = tableWatchers.get(key);
  if (!set) {
    set = new Set();
    tableWatchers.set(key, set);
  }
  set.add(send);
  return () => {
    const s = tableWatchers.get(key);
    if (!s) return;
    s.delete(send);
    if (s.size === 0) tableWatchers.delete(key);
  };
}

/** Close every channel. Used by tests and graceful shutdown. */
export function stopHub(): void {
  for (const timer of retryTimers.values()) clearTimeout(timer);
  retryTimers.clear();
  for (const ch of channels.values()) {
    try {
      ch.unsubscribe();
    } catch {}
  }
  channels.clear();
  subscribed.clear();
}

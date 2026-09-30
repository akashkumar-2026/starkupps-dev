import { getSupabaseAdmin } from "./db/supabase";

// Server-brokered realtime relay.
//
// Why this exists: operational tables (orders, deliveries) are deny-by-default
// under RLS, so browsers cannot subscribe to them directly with the anon key.
// Instead the gateway — which uses the service-role client and bypasses RLS —
// holds ONE postgres_changes subscription per table and fans events out to
// authenticated SSE connections (/api/stream/admin) and token-gated order
// tracking streams (/api/public/orders/stream).
//
// Clients must still treat SSE as best-effort (polling remains the fallback).

export type ChangeTable = "orders" | "deliveries";
export type ChangeEvent = {
  table: ChangeTable;
  event: "INSERT" | "UPDATE" | "DELETE";
  id: number;
  outletId: number | null;
  status: string | null;
  orderNumber: number | null;
};

type Send = (ev: ChangeEvent) => void;

const orderWatchers = new Map<number, Set<Send>>();
const outletWatchers = new Map<string, Set<Send>>(); // `${table}:${outletId}` or `${table}:*`

let started = false;
let startFailedAt = 0;
let subscribeStatus: string | null = null;

export function hubStatus() {
  return {
    started,
    subscribeStatus,
    orderWatchers: orderWatchers.size,
    outletWatchers: outletWatchers.size,
  };
}

function emit(ev: ChangeEvent) {
  const direct = orderWatchers.get(ev.id);
  if (direct) for (const send of Array.from(direct)) safeSend(send, ev);
  if (ev.outletId != null) {
    const scoped = outletWatchers.get(`${ev.table}:${ev.outletId}`);
    if (scoped) for (const send of Array.from(scoped)) safeSend(send, ev);
  }
  const all = outletWatchers.get(`${ev.table}:*`);
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
  };
}

export function ensureHubStarted() {
  if (started) return;
  // Back off 30s after a failure so broken credentials don't spin.
  if (startFailedAt && Date.now() - startFailedAt < 30_000) return;
  started = true;
  try {
    const supabase = getSupabaseAdmin();
    const ch = supabase.channel("gateway-relay");
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders" },
      (p: any) => {
        const ev = toEvent("orders", p);
        if (ev) emit(ev);
      }
    );
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "deliveries" },
      (p: any) => {
        const ev = toEvent("deliveries", p);
        if (ev) emit(ev);
      }
    );
    ch.subscribe((status: string) => {
      subscribeStatus = status;
      if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        console.warn(`[realtime] gateway relay subscribe status: ${status}`);
      }
    });
  } catch (e) {
    startFailedAt = Date.now();
    console.warn(
      "[realtime] gateway relay failed to start:",
      (e as Error)?.message ?? e
    );
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
  let set = outletWatchers.get(key);
  if (!set) {
    set = new Set();
    outletWatchers.set(key, set);
  }
  set.add(send);
  return () => {
    const s = outletWatchers.get(key);
    if (!s) return;
    s.delete(send);
    if (s.size === 0) outletWatchers.delete(key);
  };
}

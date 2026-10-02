import { useEffect, useRef, useState } from "react";

/**
 * Live status of the gateway's SSE relay, per topic.
 *
 * `useAdminStream` owns the socket, so this is a tiny shared registry rather
 * than a context: every caller already has its own EventSource, and the header
 * only needs to know "is anything connected right now".
 *
 * Entries are removed on unmount, so a closed panel stops contributing to the
 * count. If no stream is mounted the indicator reads "offline", which is the
 * honest state — nothing is connected because nothing asked to be.
 */
export type RealtimeState = "connecting" | "live" | "reconnecting" | "closed";

type Entry = { state: RealtimeState; at: number };

const registry = new Map<string, Entry>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function setRealtimeState(topic: string, state: RealtimeState) {
  registry.set(topic, { state, at: Date.now() });
  notify();
}

export function clearRealtimeState(topic: string) {
  registry.delete(topic);
  notify();
}

export function useRealtimeStatus(): {
  topics: string[];
  state: RealtimeState;
} {
  const [, force] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const listener = () => {
      if (mounted.current) force(n => n + 1);
    };
    listeners.add(listener);
    return () => {
      mounted.current = false;
      listeners.delete(listener);
    };
  }, []);

  const entries = Array.from(registry.values());
  const topics = Array.from(registry.keys()).sort();

  if (entries.length === 0) return { topics, state: "closed" };
  // Worst-state-wins: one reconnecting stream means the panel is not fully live.
  if (entries.some(e => e.state === "reconnecting"))
    return { topics, state: "reconnecting" };
  if (entries.some(e => e.state === "connecting"))
    return { topics, state: "connecting" };
  return { topics, state: "live" };
}

/**
 * EventSource-backed subscription to one gateway relay topic.
 *
 * Reports its own state into the registry above so the header can show whether
 * live updates are actually arriving, instead of the panel silently degrading
 * to its polling fallback with no indication.
 *
 * On every successful open the caller is asked to re-sync, because a reconnect
 * may have missed changes while the socket was down.
 */
export function useAdminStream(opts: {
  enabled: boolean;
  topic: StreamTable;
  outletId?: number | "all";
  onEvent: (ev: StreamEvent) => void;
  /** Called on every (re)subscribe, including the first. */
  onSync?: () => void;
}) {
  const { enabled, topic, outletId, onEvent, onSync } = opts;
  const cb = useRef(onEvent);
  cb.current = onEvent;
  const sync = useRef(onSync);
  sync.current = onSync;
  // Unique per mounted instance so two panels on the same topic do not share a
  // registry entry, and so a remount always reads as a fresh connection.
  const instanceId = useRef(`${topic}:${Math.random().toString(36).slice(2)}`);
  const registryKey = instanceId.current;

  useEffect(() => {
    if (
      !enabled ||
      typeof window === "undefined" ||
      typeof EventSource === "undefined"
    )
      return;
    const q = new URLSearchParams({ topic });
    if (outletId !== undefined) q.set("outletId", String(outletId));
    let es: EventSource | null = null;
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = () => {
      if (closed) return;
      setRealtimeState(registryKey, "reconnecting");
      const delay =
        Math.min(30_000, 1000 * 2 ** retry) + Math.floor(Math.random() * 500);
      retry = Math.min(retry + 1, 5);
      timer = setTimeout(connect, delay);
    };

    const connect = () => {
      if (closed) return;
      try {
        es = new EventSource(`/api/stream/admin?${q.toString()}`);
      } catch {
        scheduleReconnect();
        return;
      }
      es.addEventListener("change", (msg: MessageEvent) => {
        retry = 0;
        try {
          const ev = JSON.parse(
            String((msg as MessageEvent).data)
          ) as StreamEvent;
          if (ev) cb.current(ev);
        } catch {}
      });
      // A successful open resets the backoff window and re-syncs, so nothing
      // that happened while the socket was down is missed.
      es.onopen = () => {
        retry = 0;
        setRealtimeState(registryKey, "live");
        sync.current?.();
      };
      // On stream error (auth/proxy/offline), close and retry with bounded
      // exponential backoff + jitter. Polling fallback covers the gap.
      es.onerror = () => {
        try {
          es?.close();
        } catch {}
        es = null;
        scheduleReconnect();
      };
    };

    setRealtimeState(registryKey, "connecting");
    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      try {
        es?.close();
      } catch {}
      clearRealtimeState(registryKey);
    };
  }, [enabled, topic, outletId, registryKey]);
}

export type StreamTable =
  "orders" | "deliveries" | "menu_items" | "menu_categories";
export type StreamEvent = {
  table: StreamTable;
  event: "INSERT" | "UPDATE" | "DELETE";
  id: number;
  outletId: number | null;
  status: string | null;
  orderNumber: number | null;
  /** Present on INSERT/UPDATE so callers can patch a cached row. */
  keys?: Record<string, unknown> | null;
};

/**
 * Polling interval that yields to a healthy realtime stream.
 *
 * The panel used to poll every 10–30 s regardless of whether live updates were
 * arriving, so a connected admin still paid that cost on top of the SSE traffic.
 * With the stream live the interval drops to a slow safety net; when it is not,
 * polling returns to its responsive setting.
 */
export function useAdaptiveRefetchInterval(
  liveMs: number,
  fallbackMs: number
): number | false {
  const { state } = useRealtimeStatus();
  return state === "live" ? liveMs : fallbackMs;
}

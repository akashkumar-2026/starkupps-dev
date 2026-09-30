import { useEffect, useRef } from "react";

export type StreamTable = "orders" | "deliveries";
export type StreamEvent = {
  table: StreamTable;
  event: "INSERT" | "UPDATE" | "DELETE";
  id: number;
  outletId: number | null;
  status: string | null;
  orderNumber: number | null;
};

// Subscribes to the gateway SSE relay (/api/stream/admin). Same-origin, so
// the session cookie is sent automatically. Best-effort: on any error the
// EventSource closes and the caller's polling fallback keeps working.
export function useAdminStream(opts: {
  enabled: boolean;
  topic: StreamTable;
  outletId?: number | "all";
  onEvent: (ev: StreamEvent) => void;
}) {
  const { enabled, topic, outletId, onEvent } = opts;
  const cb = useRef(onEvent);
  cb.current = onEvent;
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
          if (ev && (ev.table === "orders" || ev.table === "deliveries"))
            cb.current(ev);
        } catch {}
      });
      // A successful open resets the backoff window.
      es.onopen = () => {
        retry = 0;
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

    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      try {
        es?.close();
      } catch {}
    };
  }, [enabled, topic, outletId]);
}

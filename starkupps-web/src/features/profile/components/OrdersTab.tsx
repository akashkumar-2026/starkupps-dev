import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, ReceiptText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchOrderStatus, orderStreamUrl, requestTrackToken } from "@/api/public";
import { useRecentOrders } from "@/features/profile/useRecentOrders";
import { EmptyState } from "@/components/shared/EmptyState";
import { OrderRow } from "./shared";
import { toast } from "sonner";
import { errorMessage } from "@/utils/errors";

/** Loosely-typed gateway response; only `status` is read. */
type OrderStatusResponse = {
  status?: string;
  order?: { status?: string };
  data?: { status?: string };
};

const TERMINAL = new Set(["completed", "cancelled"]);

function TrackableOrder({ order }: { order: ReturnType<typeof useRecentOrders>[number] }) {
  const [status, setStatus] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(
    () => () => {
      try {
        esRef.current?.close();
      } catch {
        // Closing an already-closed stream is not an error.
      }
      esRef.current = null;
    },
    [],
  );

  const refresh = async () => {
    setBusy(true);
    try {
      const response = await fetchOrderStatus<OrderStatusResponse>(order.id, order.phone);
      const nextStatus =
        response?.status ?? response?.order?.status ?? response?.data?.status ?? null;
      setStatus(nextStatus);
      setTried(true);
      if (!nextStatus) toast.info("Kitchen hasn't updated this order yet.");
    } catch (error: unknown) {
      toast.error("Couldn't fetch live status", { description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const track = async () => {
    if (!order.phone) {
      toast.error("This order has no phone number attached.");
      return;
    }
    // Already live — fall back to a manual refresh.
    if (esRef.current) {
      await refresh();
      return;
    }
    setBusy(true);
    try {
      // Short-lived token (15 min) proves ownership without putting the phone
      // in server logs on every reconnect.
      const { token } = await requestTrackToken(order.id, order.phone);
      const es = new EventSource(orderStreamUrl(token));
      esRef.current = es;
      es.addEventListener("order", (msg: MessageEvent) => {
        try {
          const event = JSON.parse(String(msg.data)) as { status?: unknown };
          if (typeof event.status === "string") {
            setStatus(event.status);
            setTried(true);
            setLive(true);
            if (TERMINAL.has(event.status)) {
              try {
                es.close();
              } catch {
                // Already closed.
              }
              if (esRef.current === es) {
                esRef.current = null;
                setLive(false);
              }
            }
          }
        } catch {
          // Malformed event payload — keep the stream open.
        }
      });
      es.onerror = () => {
        // Stream unavailable — degrade to one-shot fetch, keep the button.
        try {
          es.close();
        } catch {
          // Already closed.
        }
        if (esRef.current === es) {
          esRef.current = null;
          setLive(false);
        }
        void refresh();
      };
      setTried(true);
    } catch {
      // Streaming is best-effort; a one-shot fetch still shows current status.
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <OrderRow
      order={order}
      status={status}
      action={
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={track}
          className="mt-1 h-8 gap-1.5 rounded-full px-3 text-xs font-semibold text-primary"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {live && status ? `Live · ${status}` : tried && status ? "Refresh" : "Track"}
        </Button>
      }
    />
  );
}

export function OrdersTab() {
  const orders = useRecentOrders();

  if (orders.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="font-display text-2xl">Orders</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every order you place from this device lands here.
          </p>
        </div>
        <EmptyState
          icon={ReceiptText}
          title="Nothing ordered yet"
          hint="When you check out, the order is saved here automatically — tap Track for live kitchen status."
          cta={{ label: "Start an order", to: "/" }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-2xl">Orders</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {orders.length} order{orders.length === 1 ? "" : "s"} on this device · tap Track for
            live status
          </p>
        </div>
        <Button asChild variant="outline" className="h-10 rounded-xl">
          <Link to="/">Order again</Link>
        </Button>
      </div>
      <div className="space-y-3">
        {orders.map((o) => (
          <TrackableOrder key={o.id} order={o} />
        ))}
      </div>
    </div>
  );
}

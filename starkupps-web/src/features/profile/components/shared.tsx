import type { ReactNode } from "react";

import { inr } from "@/utils/format";
import { ORDER_TYPE_LABELS } from "@/types/orders";
import type { RecentOrder } from "@/types/profile";

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-veg/15 text-veg",
  preparing: "bg-primary/15 text-primary",
  ready: "bg-primary/15 text-primary",
  completed: "bg-veg/15 text-veg",
  delivered: "bg-veg/15 text-veg",
  cancelled: "bg-destructive/10 text-destructive",
};

export function OrderStatusBadge({ status }: { status?: string | null | undefined }) {
  if (!status) return null;
  const className = STATUS_STYLES[status.toLowerCase()] ?? "bg-muted text-muted-foreground";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${className}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function OrderRow({
  order,
  status,
  action,
}: {
  order: RecentOrder;
  status?: string | null;
  action?: ReactNode;
}) {
  const placed = new Date(order.placedAt).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-card sm:gap-4">
      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 font-display text-base font-semibold text-primary">
        #{String(order.orderNumber).slice(-2)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold tabular-nums">Order #{order.orderNumber}</p>
          <OrderStatusBadge status={status} />
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {ORDER_TYPE_LABELS[order.type]}
          {order.outletName ? ` · ${order.outletName}` : ""} · {order.itemCount} item
          {order.itemCount === 1 ? "" : "s"} · {placed}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold tabular-nums">{inr(order.total)}</p>
        {action}
      </div>
    </div>
  );
}

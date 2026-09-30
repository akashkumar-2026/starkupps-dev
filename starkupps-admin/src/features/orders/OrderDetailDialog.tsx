import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ErrorPanel, PageLoading } from "@/components/shared/StatePanels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import { inr, timeLabel } from "@/utils/format";
import { useEffect, useState } from "react";

import { type OrderStatus, modifierNames, statusMeta } from "./order-ui";

export function OrderDetailDialog({
  order,
  open,
  loading,
  error,
  onClose,
  onAdvance,
  onCancel,
  busy,
}: {
  order?: any;
  open: boolean;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onAdvance: (status: OrderStatus) => void;
  onCancel: (reason: string) => void;
  busy: boolean;
}) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => setReason(""), [order?.id]);
  return (
    <Dialog open={open} onOpenChange={next => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-[#D8CDC0] bg-[#FCFAF6] sm:max-w-[520px]">
        {loading ? (
          <PageLoading />
        ) : error ? (
          <ErrorPanel detail={error} retry={onClose} />
        ) : order ? (
          <>
            <DialogHeader>
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#A83825]">
                Order detail
              </p>
              <DialogTitle className="text-2xl font-extrabold tracking-[-0.05em]">
                Ticket #{order.orderNumber}
              </DialogTitle>
              <DialogDescription>
                {order.customerName || "Walk-in guest"} ·{" "}
                {order.type?.replace("_", " ")}
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-between rounded-xl border border-[#E4DCD1] bg-[#F7F2EB] px-4 py-3">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#8A7D70]">
                  Created
                </p>
                <p className="mt-1 text-sm font-extrabold">
                  {order.createdAt ? timeLabel(new Date(order.createdAt)) : "-"}
                </p>
              </div>
              <Badge
                className={cn(
                  "border px-2.5 py-1 text-[10px]",
                  statusMeta[order.status as OrderStatus]?.badge
                )}
              >
                {statusMeta[order.status as OrderStatus]?.label ?? order.status}
              </Badge>
            </div>
            <div className="divide-y divide-[#E7DED4] border-y border-[#E7DED4]">
              {order.items?.map((item: any) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-4 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-extrabold">
                      {item.quantity}× {item.itemName}
                      {item.variantName ? ` — ${item.variantName}` : ""}
                    </p>
                    {item.variantName && (
                      <p className="text-[11px] text-[#827568]">
                        {item.variantQuantity
                          ? `${item.variantQuantity} ${item.variantUnit ?? ""}`.trim()
                          : ""}
                        {item.sku ? ` · SKU ${item.sku}` : ""}
                        {item.unitPrice
                          ? ` · ${inr(Number(item.unitPrice))} each`
                          : ""}
                      </p>
                    )}
                    {modifierNames(item).length ? (
                      <p className="text-[11px] text-[#5A4E45]">
                        + {modifierNames(item).join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <span className="font-mono text-xs font-semibold shrink-0">
                    {inr(Number(item.lineTotal))}
                  </span>
                </div>
              ))}
            </div>
            {order.notes && (
              <div className="rounded-xl border border-[#F0D5B2] bg-[#FFF8E8] p-4">
                <p className="text-sm font-semibold leading-5 text-[#634A27]">
                  {order.notes}
                </p>
              </div>
            )}
            <div className="flex items-end justify-between">
              <span className="text-sm font-bold text-[#73675B]">
                Order total
              </span>
              <span className="text-2xl font-extrabold tracking-[-0.05em]">
                {inr(Number(order.total))}
              </span>
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              {statusMeta[order.status as OrderStatus]?.next && (
                <Button
                  disabled={busy}
                  className="bg-[#211B18] text-white"
                  onClick={() =>
                    onAdvance(
                      statusMeta[order.status as OrderStatus].next!.status
                    )
                  }
                >
                  {statusMeta[order.status as OrderStatus].next!.label}
                </Button>
              )}
              {order.status !== "completed" && order.status !== "cancelled" && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setCancelOpen(true)}
                >
                  Cancel order
                </Button>
              )}
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
            <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
              <DialogContent className="border-[#D8CDC0] bg-[#FCFAF6]">
                <DialogHeader>
                  <DialogTitle>Cancel ticket #{order.orderNumber}</DialogTitle>
                  <DialogDescription>
                    Provide a reason for cancellation.
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Reason (min 3 characters)"
                />
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setCancelOpen(false)}
                  >
                    Keep ticket
                  </Button>
                  <Button
                    disabled={busy || reason.trim().length < 3}
                    className="bg-[#B83D29] hover:bg-[#962C20] text-white"
                    onClick={() => {
                      onCancel(reason.trim());
                      setCancelOpen(false);
                    }}
                  >
                    Confirm cancel
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

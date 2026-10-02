import { trpc } from "@/api/trpc";
import { CursorPagination } from "@/components/shared/CursorPagination";
import { FilterButton } from "@/components/shared/FilterButton";
import {
  EmptyPanel,
  ErrorPanel,
  PageLoading,
} from "@/components/shared/StatePanels";
import { PageHeading } from "@/components/shared/PageHeading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useAdaptiveRefetchInterval,
  useAdminStream,
} from "@/hooks/use-admin-stream";
import { useShiftScope } from "@/state/shift-scope";
import { apiError } from "@/utils/errors";
import { inr } from "@/utils/format";
import { Plus, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import { OrderDetailDialog } from "./OrderDetailDialog";
import { OrderIntakeDialog } from "./OrderIntakeDialog";
import { type OrderStatus, orderStatuses, statusMeta } from "./order-ui";

export default function OrdersPage({ detailId }: { detailId?: number }) {
  const [intakeOpen, setIntakeOpen] = useState(false);
  return (
    <>
      <LegacyOrdersPage detailId={detailId} />
      <Button
        onClick={() => setIntakeOpen(true)}
        className="fixed bottom-5 right-5 z-20 rounded-xl bg-[#E2533C] px-4 text-xs font-bold text-white shadow-[0_10px_24px_rgba(226,83,60,0.3)] hover:bg-[#C94734]"
      >
        <Plus className="mr-1 h-4 w-4" />
        Record ticket
      </Button>
      <OrderIntakeDialog open={intakeOpen} onOpenChange={setIntakeOpen} />
    </>
  );
}

function LegacyOrdersPage({ detailId }: { detailId?: number }) {
  const shiftScope = useShiftScope();
  const [status, setStatus] = useState<OrderStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<number | undefined>();
  const [history, setHistory] = useState<Array<number | undefined>>([]);
  const [, setLocation] = useLocation();
  const input = useMemo(
    () => ({
      limit: 24,
      status: status === "all" ? undefined : status,
      search: search.trim() || undefined,
      cursor,
      shiftId: shiftScope.shiftId,
    }),
    [cursor, search, shiftScope.shiftId, status]
  );
  // Fast poll only while the relay is down; a live stream makes it a safety net.
  const ordersPollMs = useAdaptiveRefetchInterval(120_000, 15_000);
  const query = trpc.admin.orders.list.useQuery(input, {
    refetchInterval: ordersPollMs,
  });
  const detail = trpc.admin.orders.byId.useQuery(
    { id: detailId ?? 0 },
    { enabled: Boolean(detailId) }
  );
  const utils = trpc.useUtils();
  // Live updates: SSE relay invalidates instantly; polling is the fallback, and
  // only runs at its responsive interval while the relay is down.
  const resync = useCallback(() => {
    void utils.admin.orders.list.invalidate();
    void utils.admin.dashboard.invalidate();
    if (detailId) void utils.admin.orders.byId.invalidate({ id: detailId });
  }, [utils, detailId]);
  useAdminStream({
    enabled: true,
    topic: "orders",
    onEvent: resync,
    // A reconnect may have missed changes while the socket was down.
    onSync: resync,
  });
  const update = trpc.admin.orders.updateStatus.useMutation({
    onMutate: async values => {
      await utils.admin.orders.list.cancel(input);
      const previous = utils.admin.orders.list.getData(input);
      utils.admin.orders.list.setData(input, current =>
        current
          ? {
              ...current,
              items: current.items.map(order =>
                order.id === values.id
                  ? { ...order, status: values.status }
                  : order
              ),
            }
          : current
      );
      return { previous };
    },
    onError: (error, _values, context) => {
      utils.admin.orders.list.setData(input, context?.previous);
      toast.error("Status change was not saved", {
        description: apiError(error),
      });
    },
    onSuccess: () =>
      toast.success("Order status saved", {
        description: "The live queue and dashboard will refresh.",
      }),
    onSettled: () => {
      void utils.admin.orders.list.invalidate();
      void utils.admin.orders.byId.invalidate();
      void utils.admin.dashboard.invalidate();
    },
  });
  const cancel = trpc.admin.orders.cancel.useMutation({
    onSuccess: () => {
      toast.success("Order cancelled");
      setLocation("/orders");
      void utils.admin.orders.list.invalidate();
      void utils.admin.dashboard.invalidate();
    },
    onError: error =>
      toast.error("Order could not be cancelled", {
        description: apiError(error),
      }),
  });
  const setPage = (next?: number) => {
    setHistory(items => [...items, cursor]);
    setCursor(next);
  };
  const reset = (nextStatus: OrderStatus | "all") => {
    setStatus(nextStatus);
    setCursor(undefined);
    setHistory([]);
  };
  const rows = query.data?.items ?? [];
  return (
    <>
      <PageHeading
        kicker="Live work"
        title="Live order queue"
        detail="Search and filter persisted order tickets. Status changes are validated server-side and recorded in the audit trail."
        action={
          <span className="flex items-center gap-2 rounded-xl border border-[#E4DCD1] bg-[#FCFAF6] px-3.5 py-2.5 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-[#468A61]" />
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#675F56]">
              Database
            </span>
            <span className="text-xs font-bold">connected</span>
          </span>
        }
      />
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          className="flex flex-wrap gap-1 rounded-xl border border-[#E4DCD1] bg-[#EEE9E1] p-1"
          aria-label="Order status filter"
        >
          <FilterButton
            label="All"
            active={status === "all"}
            onClick={() => reset("all")}
          />
          {orderStatuses.map(entry => (
            <FilterButton
              key={entry}
              label={statusMeta[entry].label}
              active={status === entry}
              onClick={() => reset(entry)}
            />
          ))}
        </div>
        <div className="relative w-full lg:w-72">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#8E8174]" />
          <Input
            value={search}
            onChange={event => {
              setSearch(event.target.value);
              setCursor(undefined);
              setHistory([]);
            }}
            placeholder="Search ticket or guest"
            className="h-10 border-[#DCCFC2] bg-[#FCFAF6] pl-9 text-xs"
          />
        </div>
      </div>
      {query.isLoading ? (
        <PageLoading />
      ) : query.isError ? (
        <ErrorPanel
          detail={apiError(query.error)}
          retry={() => query.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyPanel
          title="No matching tickets"
          detail={
            search || status !== "all"
              ? "Clear the search or status filter to widen the queue."
              : "Orders will appear here as soon as your integration creates them."
          }
          action={
            search || status !== "all" ? (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch("");
                  reset("all");
                }}
                className="text-xs"
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] shadow-[0_8px_20px_rgba(55,38,25,0.04)]">
          <div className="divide-y divide-[#E7DED4]">
            {rows.map((order: any) => (
              <div
                key={order.id}
                className="flex items-center justify-between gap-3 px-5 py-4"
              >
                <div>
                  <p className="text-sm font-extrabold">
                    #{order.orderNumber} — {order.customerName || "Walk-in"}
                  </p>
                  <p className="text-xs text-[#827568]">
                    {order.status} · {inr(order.total)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => setLocation(`/orders/${order.id}`)}
                  >
                    View
                  </Button>
                  {statusMeta[order.status as OrderStatus]?.next && (
                    <Button
                      className="h-8 bg-[#211B18] text-xs text-white"
                      onClick={() =>
                        update.mutate({
                          id: order.id,
                          status:
                            statusMeta[order.status as OrderStatus].next!
                              .status,
                        })
                      }
                    >
                      {statusMeta[order.status as OrderStatus].next!.label}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <CursorPagination
        nextCursor={query.data?.nextCursor}
        canGoBack={history.length > 0}
        onNext={() => query.data?.nextCursor && setPage(query.data.nextCursor)}
        onBack={() => {
          const prev = history.at(-1);
          setHistory(h => h.slice(0, -1));
          setCursor(prev);
        }}
      />
      <OrderDetailDialog
        order={detail.data ?? undefined}
        open={Boolean(detailId)}
        loading={detail.isLoading}
        error={detail.isError ? apiError(detail.error) : null}
        onClose={() => setLocation("/orders")}
        onAdvance={s => detailId && update.mutate({ id: detailId, status: s })}
        onCancel={reason => detailId && cancel.mutate({ id: detailId, reason })}
        busy={update.isPending || cancel.isPending}
      />
    </>
  );
}

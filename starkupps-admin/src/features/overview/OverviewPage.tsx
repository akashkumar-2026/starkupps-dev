import { MetricCard } from "@/components/shared/MetricCard";
import { PageHeading } from "@/components/shared/PageHeading";
import { ErrorPanel, PageLoading } from "@/components/shared/StatePanels";
import { trpc } from "@/api/trpc";
import {
  useAdaptiveRefetchInterval,
  useAdminStream,
} from "@/hooks/use-admin-stream";
import { useShiftScope } from "@/state/shift-scope";
import { apiError } from "@/utils/errors";
import { inr } from "@/utils/format";
import { Button } from "@/components/ui/button";
import { ChevronRight, Clock3 } from "lucide-react";
import { useCallback } from "react";
import { Link } from "wouter";

export default function OverviewPage() {
  const shiftScope = useShiftScope();
  // The dashboard counters are driven by the relay; polling at its responsive
  // 30 s only makes sense while that relay is unavailable.
  const dashboardPollMs = useAdaptiveRefetchInterval(180_000, 30_000);
  const metrics = trpc.admin.dashboard.useQuery(
    shiftScope.shiftId ? { shiftId: shiftScope.shiftId } : undefined,
    { refetchInterval: dashboardPollMs }
  );
  const utils = trpc.useUtils();
  const resync = useCallback(() => {
    void utils.admin.dashboard.invalidate();
  }, [utils]);
  useAdminStream({
    enabled: true,
    topic: "orders",
    onEvent: resync,
    // Re-sync on every (re)subscribe so a reconnect cannot leave stale counters.
    onSync: resync,
  });
  if (metrics.isLoading) return <PageLoading />;
  if (metrics.isError)
    return (
      <ErrorPanel
        detail={apiError(metrics.error)}
        retry={() => metrics.refetch()}
      />
    );
  const data = metrics.data!;
  return (
    <>
      <PageHeading
        kicker="Operational pulse"
        title="A steady room makes for a better rush."
        detail="This snapshot reflects the stored order and guest records currently in your workspace."
        action={
          <Link href="/orders">
            <Button className="rounded-xl bg-[#211B18] text-xs font-bold text-white hover:bg-[#3A2D27]">
              Open live queue <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Open tickets"
          value={String(data.openCount).padStart(2, "0")}
          detail="Orders needing a handoff"
          tone="red"
        />
        <MetricCard
          label="Revenue in range"
          value={inr(data.totalRevenue)}
          detail="Paid, non-cancelled orders"
          tone="amber"
        />
        <MetricCard
          label="Tickets served"
          value={String(data.servedCount)}
          detail="Completed order records"
          tone="green"
        />
        <MetricCard
          label="Guest return"
          value={`${data.repeatRate.toFixed(1)}%`}
          detail="Based on stored guests"
          tone="ink"
        />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_300px]">
        <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5 shadow-[0_8px_20px_rgba(55,38,25,0.04)]">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#928477]">
            Service tempo
          </p>
          <h3 className="mt-1 text-lg font-extrabold tracking-[-0.035em]">
            Prep time is{" "}
            {data.averagePrepMinutes
              ? `${data.averagePrepMinutes.toFixed(1)} minutes`
              : "waiting for completed orders"}
            .
          </h3>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[#776A5E]">
            As orders move through the queue, the dashboard recalculates open
            work, paid sales, completed tickets, and returning-guest share from
            persistent data.
          </p>
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-[#E6DDD2] bg-[#F7F2EB] p-4">
            <Clock3 className="h-5 w-5 text-[#A83825]" />
            <div>
              <p className="text-xs font-extrabold">
                A clean start is a valid state.
              </p>
              <p className="mt-1 text-[11px] text-[#83766A]">
                Create orders from your connected ordering system, then use the
                queue to run the pass.
              </p>
            </div>
          </div>
        </section>
        <section className="overflow-hidden rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] shadow-[0_8px_20px_rgba(55,38,25,0.04)]">
          <div className="relative h-[112px]">
            <img
              src="https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=800&q=80"
              alt="Coffee and pizza"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#211B18]/80 via-[#211B18]/30 to-transparent" />
            <p className="absolute bottom-3 left-4 font-mono text-[9px] uppercase tracking-[0.15em] text-[#F9D5B2]">
              Counter note
            </p>
          </div>
          <div className="p-4">
            <p className="text-sm font-extrabold">
              Run the room from the record.
            </p>
            <p className="mt-2 text-xs leading-5 text-[#776A5E]">
              Every operational panel begins empty until your team adds or
              integrates real records.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}

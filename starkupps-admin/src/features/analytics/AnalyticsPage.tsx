import { trpc } from "@/api/trpc";
import { MetricCard } from "@/components/shared/MetricCard";
import { PageHeading } from "@/components/shared/PageHeading";
import { ErrorPanel, PageLoading } from "@/components/shared/StatePanels";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useShiftScope } from "@/state/shift-scope";
import { useOutlet } from "@/state/outlet-provider";
import { apiError } from "@/utils/errors";
import { inr } from "@/utils/format";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Soup } from "lucide-react";
import { useMemo, useState } from "react";

export default function AnalyticsPage() {
  const shiftScope = useShiftScope();
  const { selectedId: outletId } = useOutlet();
  const [rangeKey, setRangeKey] = useState<"7" | "30" | "90">("30");
  const range = useMemo(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - Number(rangeKey));
    // normalize to start of day for stable cache key
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }, [rangeKey]);
  const input = useMemo(
    () => ({
      ...range,
      shiftId: shiftScope.shiftId,
      outletId: outletId ?? undefined,
    }),
    [range, shiftScope.shiftId, outletId]
  );
  const data = trpc.analytics.overview.useQuery(input);
  if (data.isLoading) return <PageLoading />;
  if (data.isError)
    return (
      <ErrorPanel detail={apiError(data.error)} retry={() => data.refetch()} />
    );
  const d = data.data!;
  const hasDaily = d.daily.length > 0;
  const hasTop = d.topItems.length > 0;
  const subtitle = outletId
    ? "Filtered by selected outlet"
    : shiftScope.shiftId
      ? `Filtered by ${shiftScope.label}`
      : "All outlets and shifts in range";
  return (
    <>
      <PageHeading
        kicker="Analytics"
        title="Store analytics"
        detail={`Revenue and order trends from persisted records. ${subtitle}.`}
        action={
          <div className="flex items-center gap-2">
            <Select
              value={rangeKey}
              onValueChange={(v: "7" | "30" | "90") => setRangeKey(v)}
            >
              <SelectTrigger className="h-9 w-[140px] border-[#DCCFC2] bg-[#FCFAF6] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="Total revenue"
          value={inr(d.totalRevenue)}
          detail={`${d.totalOrders} orders in range`}
          tone="amber"
        />
        <MetricCard
          label="Total orders"
          value={String(d.totalOrders)}
          detail="Non-cancelled tickets"
          tone="ink"
        />
        <MetricCard
          label="Average order value"
          value={inr(d.averageOrderValue)}
          detail={hasDaily ? "Paid revenue / orders" : "No paid orders"}
          tone="green"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5 shadow-[0_8px_20px_rgba(55,38,25,0.04)] lg:col-span-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#928477]">
                Daily revenue
              </p>
              <p className="mt-1 text-sm font-extrabold tracking-[-0.02em]">
                Paid orders only
              </p>
            </div>
            <span className="rounded-full border border-[#E4DCD1] bg-white px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[#8B7E71]">
              {rangeKey}d • {shiftScope.label} •{" "}
              {outletId ? `Outlet #${outletId}` : "All outlets"}
            </span>
          </div>
          <div className="mt-4 h-[240px]">
            {hasDaily ? (
              <ChartContainer
                config={{ revenue: { label: "Revenue", color: "#A83825" } }}
                className="h-[240px] w-full aspect-auto"
              >
                <AreaChart
                  data={d.daily}
                  margin={{ left: 8, right: 12, top: 8, bottom: 0 }}
                >
                  <CartesianGrid
                    vertical={false}
                    strokeDasharray="3 3"
                    stroke="#E7DED4"
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "#8B7E71" }}
                    tickFormatter={(v: string) => v.slice(5)}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#8B7E71" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) =>
                      `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`
                    }
                    width={48}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value: any) => inr(Number(value))}
                      />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#E2533C"
                    fill="#E2533C"
                    fillOpacity={0.14}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{
                      r: 3,
                      fill: "#A83825",
                      stroke: "#FCFAF6",
                      strokeWidth: 2,
                    }}
                  />
                </AreaChart>
              </ChartContainer>
            ) : (
              <div className="grid h-[240px] place-items-center rounded-xl border border-dashed border-[#D5C8BA] bg-white p-6 text-center">
                <div>
                  <BarChart3 className="mx-auto h-6 w-6 text-[#A39486]" />
                  <p className="mt-3 text-sm font-extrabold">
                    No sales data in this range
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[#827568]">
                    Try a wider date range, clear the shift filter, or switch to
                    All outlets.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5 shadow-[0_8px_20px_rgba(55,38,25,0.04)] lg:col-span-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#928477]">
            Top products
          </p>
          <h3 className="mt-1 text-sm font-extrabold tracking-[-0.02em]">
            By revenue
          </h3>
          <div className="mt-4 h-[240px]">
            {hasTop ? (
              <ChartContainer
                config={{
                  revenue: { label: "Revenue", color: "#685E55" },
                  units: { label: "Units", color: "#D5962A" },
                }}
                className="h-[240px] w-full aspect-auto"
              >
                <BarChart
                  data={d.topItems.slice(0, 6)}
                  layout="vertical"
                  margin={{ left: 12, right: 16, top: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    horizontal={false}
                    strokeDasharray="3 3"
                    stroke="#E7DED4"
                  />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10, fill: "#8B7E71" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `₹${v}`}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "#5A4E45" }}
                    axisLine={false}
                    tickLine={false}
                    width={96}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value: any, name: any) =>
                          name === "revenue"
                            ? inr(Number(value))
                            : `${value} units`
                        }
                      />
                    }
                  />
                  <Bar
                    dataKey="revenue"
                    fill="#685E55"
                    radius={[0, 8, 8, 0]}
                    barSize={18}
                  />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="grid h-[240px] place-items-center rounded-xl border border-dashed border-[#D5C8BA] bg-white p-6 text-center">
                <div>
                  <Soup className="mx-auto h-6 w-6 text-[#A39486]" />
                  <p className="mt-3 text-sm font-extrabold">
                    No products sold yet
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[#827568]">
                    Recorded order items will appear here once tickets are
                    completed.
                  </p>
                </div>
              </div>
            )}
          </div>
          {hasTop && (
            <ul className="mt-3 divide-y divide-[#E7DED4] rounded-xl border border-[#E7DED4] bg-white">
              {d.topItems.slice(0, 5).map((it: any) => (
                <li
                  key={it.name}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <span className="truncate text-xs font-bold text-[#211B18]">
                    {it.name}
                  </span>
                  <span className="ml-3 shrink-0 font-mono text-xs font-semibold text-[#5A4E45]">
                    {it.units} × {inr(it.revenue)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

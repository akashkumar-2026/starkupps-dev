import { inr } from "@/utils/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/api/trpc";
import { useOutlet } from "@/state/outlet-provider";
import { Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

export default function CustomersHub({ detailId }: { detailId?: number }) {
  const [location, setLocation] = useLocation();
  if (detailId)
    return (
      <Customer360 id={detailId} onBack={() => setLocation("/customers")} />
    );
  if (
    location.includes("/customers/segments") ||
    location === "/customers/segments"
  )
    return <SegmentsView />;
  return <CustomersList />;
}

function CustomersList() {
  const { selectedId } = useOutlet();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState<
    "createdAt" | "totalSpend" | "totalOrders" | "lastOrder"
  >("createdAt");
  const [cursors, setCursors] = useState<string[]>([]);
  const [, setLocation] = useLocation();
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setCursors([]);
    }, 400);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    setCursors([]);
  }, [sortBy, selectedId]);
  const cursor = cursors.length ? cursors[cursors.length - 1] : undefined;
  const q = trpc.customers.list.useQuery({
    search: debouncedSearch || undefined,
    outletId: selectedId ?? undefined,
    limit: 25,
    sortBy,
    direction: "desc" as any,
    cursor,
  });
  return (
    <>
      <section className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#A83825]">
            <span className="h-px w-7 bg-[#E2533C]" />
            Customers
          </p>
          <h2 className="text-3xl font-extrabold tracking-[-0.055em]">
            Know every guest, by outlet and lifetime.
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#75695E]">
            Global customer identity with outlet filter, pagination, and
            server-side aggregates.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setLocation("/customers/segments")}
          className="border-[#D8CDC0] bg-[#FCFAF6] text-xs"
        >
          Segments
        </Button>
      </section>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#8E8174]" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, phone, email"
            className="h-10 border-[#DCCFC2] bg-[#FCFAF6] pl-9 text-xs"
          />
        </div>
        <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
          <SelectTrigger className="h-9 w-[180px] border-[#DCCFC2] bg-white text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="createdAt">Newest</SelectItem>
            <SelectItem value="totalSpend">Highest spend</SelectItem>
            <SelectItem value="totalOrders">Most orders</SelectItem>
            <SelectItem value="lastOrder">Last order</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {q.isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : q.isError ? (
        <p className="text-sm text-[#8D5145]">
          {String((q.error as any)?.message)}
        </p>
      ) : !q.data?.items.length ? (
        <div className="grid place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-8 text-center">
          <p className="text-sm font-bold">No customers found.</p>
          <p className="text-xs text-[#827568]">
            Customers appear after orders or loyalty creation. Try clearing
            filters.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6]">
          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-[860px] w-full text-left">
              <thead className="border-b bg-[#F7F2EB]">
                <tr>
                  {[
                    "Customer",
                    "Phone",
                    "Orders",
                    "Spend",
                    "Last order",
                    "Loyalty",
                    "",
                  ].map(h => (
                    <th
                      key={h}
                      className="px-4 py-3 font-mono text-[9px] uppercase tracking-[0.11em] text-[#87796C]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {q.data.items.map((c: any) => (
                  <tr key={c.id} className="hover:bg-white text-xs">
                    <td className="px-4 py-3 font-bold">
                      {c.name ?? "—"}
                      <p className="text-[11px] font-normal text-[#87796C]">
                        {c.email ?? ""}
                      </p>
                    </td>
                    <td className="px-4 py-3">{c.phone}</td>
                    <td className="px-4 py-3">{c.totalOrders}</td>
                    <td className="px-4 py-3">{inr(c.totalSpend)}</td>
                    <td className="px-4 py-3 text-[#6F6257]">
                      {c.lastOrderAt
                        ? new Date(c.lastOrderAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3">{c.loyaltyPoints} pts</td>
                    <td className="px-4 py-3">
                      <Button
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => setLocation(`/customers/${c.id}`)}
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-2 p-3 md:hidden">
            {q.data.items.map((c: any) => (
              <div
                key={c.id}
                className="rounded-xl border border-[#E4DCD1] bg-white p-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-bold">{c.name ?? c.phone}</p>
                    <p className="text-xs text-[#87796C]">{c.phone}</p>
                  </div>
                  <Badge className="border-[#E3D9CE] bg-[#F6F0E8] text-[#706356]">
                    {c.totalOrders} orders
                  </Badge>
                </div>
                <p className="mt-2 text-xs">
                  {inr(c.totalSpend)} · {c.loyaltyPoints} pts
                </p>
                <Button
                  variant="outline"
                  className="mt-3 h-7 text-xs w-full"
                  onClick={() => setLocation(`/customers/${c.id}`)}
                >
                  Open profile
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
      {(q.data as any)?.nextCursor && (
        <div className="mt-3 flex justify-end gap-2">
          {cursors.length > 0 && (
            <Button
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setCursors(c => c.slice(0, -1))}
            >
              Newer
            </Button>
          )}
          <Button
            variant="outline"
            className="h-8 text-xs"
            disabled={q.isFetching}
            onClick={() => {
              const nc = (q.data as any)?.nextCursor;
              if (nc) setCursors(c => [...c, nc]);
            }}
          >
            Older
          </Button>
        </div>
      )}
    </>
  );
}

function Customer360({ id, onBack }: { id: number; onBack: () => void }) {
  const q = trpc.customers.byId.useQuery({ id });
  const [tab, setTab] = useState<"profile" | "orders" | "loyalty" | "feedback">(
    "profile"
  );
  if (q.isLoading)
    return (
      <div className="grid place-items-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div className="rounded-[14px] border border-[#F1C9BD] bg-[#FFF8F5] p-5 text-sm">
        Customer not found{" "}
        <Button variant="outline" onClick={onBack} className="ml-2 h-7 text-xs">
          Back
        </Button>
      </div>
    );
  const { customer, metrics, orders, transactions, feedbacks } = q.data as any;
  return (
    <>
      <Button variant="ghost" onClick={onBack} className="mb-4 px-0 text-xs">
        ← Customers
      </Button>
      <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-extrabold">
              {customer.name ?? "Unnamed guest"}
            </h2>
            <p className="text-xs text-[#776A5E]">
              {customer.phone} · {customer.email ?? "No email"} · Joined{" "}
              {new Date(customer.createdAt).toLocaleDateString()}
            </p>
          </div>
          <Badge className="bg-[#E5F2E9] text-[#2F6947] border-[#BDE0C8]">
            {metrics.totalOrders} orders
          </Badge>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border bg-white p-3 text-center">
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
              Lifetime value
            </p>
            <p className="mt-1 text-sm font-extrabold">
              {inr(metrics.totalSpend)}
            </p>
          </div>
          <div className="rounded-xl border bg-white p-3 text-center">
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
              AOV
            </p>
            <p className="mt-1 text-sm font-extrabold">
              {inr(metrics.averageOrderValue)}
            </p>
          </div>
          <div className="rounded-xl border bg-white p-3 text-center">
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
              Loyalty
            </p>
            <p className="mt-1 text-sm font-extrabold">
              {metrics.loyaltyPoints} pts
            </p>
          </div>
          <div className="rounded-xl border bg-white p-3 text-center">
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
              Last order
            </p>
            <p className="mt-1 text-xs font-bold">
              {metrics.lastOrder
                ? new Date(metrics.lastOrder).toLocaleDateString()
                : "—"}
            </p>
          </div>
        </div>
        <div className="mt-5 flex gap-1 rounded-xl border bg-[#EEE9E1] p-1 w-fit">
          {(["profile", "orders", "loyalty", "feedback"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold capitalize ${tab === t ? "bg-white shadow-sm" : "text-[#766A5F]"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </section>
      <div className="mt-5">
        {tab === "profile" && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[14px] border bg-[#FCFAF6] p-5">
              <h3 className="text-sm font-extrabold">Favorite products</h3>
              {!metrics.favoriteProducts.length ? (
                <p className="mt-3 text-xs text-[#827568]">
                  No product history yet.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {metrics.favoriteProducts.map((f: any) => (
                    <li key={f.name} className="flex justify-between text-xs">
                      <span>{f.name}</span>
                      <span className="font-bold">{f.qty}×</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-[14px] border bg-[#FCFAF6] p-5">
              <h3 className="text-sm font-extrabold">Outlet usage</h3>
              {!metrics.outletUsage.length ? (
                <p className="mt-3 text-xs text-[#827568]">No outlet usage.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {metrics.outletUsage.map((o: any) => (
                    <li key={o.name} className="flex justify-between text-xs">
                      <span>{o.name}</span>
                      <span className="font-bold">{o.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        {tab === "orders" && (
          <div className="divide-y rounded-[14px] border bg-[#FCFAF6]">
            {!orders.length ? (
              <p className="p-8 text-center text-xs text-[#827568]">
                No orders.
              </p>
            ) : (
              orders.map((o: any) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between p-4"
                >
                  <div>
                    <p className="text-sm font-bold">
                      #{o.orderNumber} · {o.status}
                    </p>
                    <p className="text-xs text-[#87796C]">
                      {o.outletName ?? "Direct"} ·{" "}
                      {new Date(o.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <span className="text-xs font-bold">
                    {inr(Number(o.total))}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
        {tab === "loyalty" && (
          <div className="rounded-[14px] border bg-[#FCFAF6] p-5">
            <h3 className="text-sm font-extrabold">Loyalty activity</h3>
            {!transactions.length ? (
              <p className="mt-3 text-xs text-[#827568]">No transactions.</p>
            ) : (
              <div className="mt-3 divide-y">
                {transactions.map((t: any) => (
                  <div key={t.id} className="flex justify-between py-2 text-xs">
                    <span>{t.reason}</span>
                    <span
                      className={
                        t.pointsChange > 0
                          ? "text-[#2F6947] font-bold"
                          : "text-[#A83825] font-bold"
                      }
                    >
                      {t.pointsChange > 0 ? "+" : ""}
                      {t.pointsChange}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {tab === "feedback" && (
          <div className="rounded-[14px] border bg-[#FCFAF6] p-5">
            <h3 className="text-sm font-extrabold">Feedback</h3>
            {!feedbacks.length ? (
              <p className="mt-3 text-xs text-[#827568]">No feedback.</p>
            ) : (
              feedbacks.map((f: any) => (
                <div key={f.id} className="mt-3 rounded-xl border bg-white p-3">
                  <p className="text-xs font-bold">⭐ {f.rating}</p>
                  <p className="text-xs text-[#6F6257]">{f.comment}</p>
                  <p className="text-[11px] text-[#87796C]">
                    {new Date(f.createdAt).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </>
  );
}

function SegmentsView() {
  const [, setLocation] = useLocation();
  const q = trpc.customers.segments.list.useQuery();
  if (q.isLoading)
    return (
      <div className="grid place-items-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
      </div>
    );
  if (q.isError)
    return (
      <div className="py-10 text-center text-sm text-[#B83D29]">
        Segments could not be loaded.{" "}
        <Button
          variant="outline"
          className="ml-2 h-7 text-xs"
          onClick={() => q.refetch()}
        >
          Retry
        </Button>
      </div>
    );
  return (
    <>
      <Button
        variant="ghost"
        onClick={() => setLocation("/customers")}
        className="mb-4 px-0 text-xs"
      >
        ← Customers
      </Button>
      <h2 className="text-xl font-extrabold">Customer segments</h2>
      <p className="mt-1 text-xs text-[#776A5E]">
        Reusable rules — e.g. total_orders ≥ 10, last_order &gt; 30 days ago —
        evaluated server-side without hardcoding each segment.
      </p>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(q.data ?? []).map((s: any) => (
          <article
            key={s.id}
            className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5"
          >
            <h3 className="text-sm font-extrabold">{s.name}</h3>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[#A83825]">
              {s.slug}
            </p>
            <p className="mt-2 text-xs text-[#6F6257]">{s.description}</p>
            <p className="mt-3 text-xs font-bold">
              {s.customerCount} customers
            </p>
            <pre className="mt-2 overflow-auto rounded-lg bg-white p-2 text-[10px] text-[#5A4E45]">
              {JSON.stringify(s.rules ?? {}, null, 2)}
            </pre>
          </article>
        ))}
      </div>
      {!q.data?.length && (
        <p className="mt-6 text-center text-xs text-[#827568]">
          No segments yet.
        </p>
      )}
    </>
  );
}

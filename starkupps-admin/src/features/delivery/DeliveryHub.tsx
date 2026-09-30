import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/api/trpc";
import { useAdminStream } from "@/hooks/use-admin-stream";
import { useOutlet } from "@/state/outlet-provider";
import { Loader2, Plus, Truck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function DeliveryHub() {
  const { selectedId } = useOutlet();
  const [tab, setTab] = useState<"live" | "riders" | "performance">("live");
  return (
    <>
      <section className="mb-6">
        <p className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#A83825]">
          <span className="h-px w-7 bg-[#E2533C]" />
          Delivery ops
        </p>
        <h2 className="text-3xl font-extrabold tracking-[-0.055em]">
          Every handoff, tracked.
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#75695E]">
          Riders and live deliveries are outlet-scoped. Single source of truth
          for assignment state.
        </p>
        <div className="mt-4 flex gap-1 rounded-xl border border-[#E4DCD1] bg-[#EEE9E1] p-1 w-fit">
          {(["live", "riders", "performance"] as const).map(t => (
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
      {tab === "live" && <LiveTab outletId={selectedId} />}
      {tab === "riders" && <RidersTab outletId={selectedId} />}
      {tab === "performance" && <PerformanceTab outletId={selectedId} />}
    </>
  );
}

function LiveTab({ outletId }: { outletId: number | null }) {
  const q = trpc.delivery.live.useQuery(outletId ? { outletId } : undefined, {
    refetchInterval: 10000,
  });
  useAdminStream({
    enabled: true,
    topic: "deliveries",
    outletId: outletId ?? "all",
    onEvent: () => {
      void q.refetch();
    },
  });
  const assign = trpc.delivery.assignments.assign.useMutation({
    onSuccess: () => {
      toast.success("Rider assigned");
      void q.refetch();
      void utils.delivery.riders.list.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const statusMut = trpc.delivery.assignments.updateStatus.useMutation({
    onSuccess: () => {
      void q.refetch();
      void utils.delivery.riders.list.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const riders = trpc.delivery.riders.list.useQuery(
    outletId
      ? { outletId, status: "available" as any }
      : { status: "available" as any }
  );
  const utils = trpc.useUtils();
  const [assignFor, setAssignFor] = useState<number | null>(null);
  const [riderId, setRiderId] = useState("");
  return (
    <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
      <h3 className="text-sm font-extrabold">Live deliveries</h3>
      {q.isLoading ? (
        <div className="grid place-items-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : q.isError ? (
        <p className="mt-4 text-center text-xs text-[#B83D29]">
          Live deliveries could not be loaded.{" "}
          <button className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : !q.data?.length ? (
        <div className="mt-4 grid place-items-center rounded-xl border border-dashed border-[#D5C8BA] bg-white p-8 text-center">
          <Truck className="mx-auto h-8 w-8 text-[#A39486]" />
          <p className="mt-3 text-sm font-bold">No active deliveries</p>
          <p className="text-xs text-[#827568]">
            Preparing → Ready → Assigned → Picked → Out for delivery → Delivered
          </p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[900px] w-full text-left">
            <thead className="border-b bg-[#F7F2EB]">
              <tr>
                {[
                  "Order",
                  "Outlet",
                  "Customer",
                  "Rider",
                  "Status",
                  "Elapsed",
                  "Actions",
                ].map(h => (
                  <th
                    key={h}
                    className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {q.data.map((d: any) => (
                <tr key={d.id} className="text-xs">
                  <td className="px-3 py-3 font-bold">
                    #{d.orderNumber ?? d.orderId}
                  </td>
                  <td className="px-3 py-3">{d.outletName ?? d.outletId}</td>
                  <td className="px-3 py-3">{d.customerName ?? "—"}</td>
                  <td className="px-3 py-3">{d.riderName ?? "Unassigned"}</td>
                  <td className="px-3 py-3">
                    <Badge className="border-[#E3D9CE] bg-[#F6F0E8]">
                      {d.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">{d.elapsedMinutes} min</td>
                  <td className="px-3 py-3 flex gap-1">
                    {!d.riderId ? (
                      <Button
                        className="h-7 text-xs bg-[#211B18] text-white"
                        onClick={() => setAssignFor(d.id)}
                      >
                        Assign
                      </Button>
                    ) : (
                      <Select
                        value={d.status}
                        onValueChange={(v: any) =>
                          statusMut.mutate({ deliveryId: d.id, status: v })
                        }
                      >
                        <SelectTrigger className="h-7 w-[160px] bg-white text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="preparing">Preparing</SelectItem>
                          <SelectItem value="ready">Ready</SelectItem>
                          <SelectItem value="rider_assigned">
                            Rider assigned
                          </SelectItem>
                          <SelectItem value="picked_up">Picked up</SelectItem>
                          <SelectItem value="out_for_delivery">
                            Out for delivery
                          </SelectItem>
                          <SelectItem value="delivered">Delivered</SelectItem>
                          <SelectItem value="failed">Failed</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog
        open={assignFor !== null}
        onOpenChange={o => !o && setAssignFor(null)}
      >
        <DialogContent className="bg-[#FCFAF6]">
          <DialogHeader>
            <DialogTitle>Assign rider</DialogTitle>
            <DialogDescription>
              Centralized dispatch — no duplicate logic.
            </DialogDescription>
          </DialogHeader>
          <Select value={riderId} onValueChange={setRiderId}>
            <SelectTrigger className="bg-white">
              <SelectValue placeholder="Select available rider" />
            </SelectTrigger>
            <SelectContent>
              {(riders.data ?? []).map((r: any) => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {r.name} — {r.phone} ({r.status})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignFor(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!riderId || assignFor === null)
                  return toast.error("Select rider");
                assign.mutate({
                  deliveryId: assignFor,
                  riderId: Number(riderId),
                });
                setAssignFor(null);
                setRiderId("");
              }}
              className="bg-[#211B18] text-white"
            >
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function RidersTab({ outletId }: { outletId: number | null }) {
  const q = trpc.delivery.riders.list.useQuery(
    outletId ? { outletId } : undefined
  );
  const outlets = trpc.outlets.list.useQuery({ limit: 100 });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    outletId: outletId ? String(outletId) : "",
    name: "",
    phone: "",
    vehicle: "bike" as any,
    status: "available" as any,
  });
  const create = trpc.delivery.riders.create.useMutation({
    onSuccess: () => {
      toast.success("Rider created");
      setOpen(false);
      void q.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const setStatus = trpc.delivery.riders.setStatus.useMutation({
    onSuccess: () => void q.refetch(),
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold">Riders</h3>
        <Button
          onClick={() => {
            setForm({
              outletId: outletId
                ? String(outletId)
                : outlets.data?.items[0]?.id
                  ? String(outlets.data.items[0].id)
                  : "",
              name: "",
              phone: "",
              vehicle: "bike",
              status: "available",
            });
            setOpen(true);
          }}
          className="bg-[#211B18] text-xs text-white"
        >
          <Plus className="mr-1 h-3 w-3" />
          Add rider
        </Button>
      </div>
      {q.isLoading ? (
        <div className="grid place-items-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : q.isError ? (
        <p className="mt-4 text-center text-xs text-[#B83D29]">
          Riders could not be loaded.{" "}
          <button className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : !q.data?.length ? (
        <div className="mt-4 grid place-items-center rounded-xl border border-dashed border-[#D5C8BA] bg-white p-8 text-center">
          <p className="text-sm font-bold">No riders yet</p>
          <p className="text-xs text-[#827568]">
            Create outlet-scoped riders with vehicle and status.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((r: any) => (
            <article
              key={r.id}
              className="rounded-xl border border-[#E4DCD1] bg-white p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-bold">{r.name}</p>
                  <p className="text-xs text-[#776A5E]">
                    {r.phone} · {r.vehicle}
                  </p>
                  <p className="text-[11px] text-[#87796C]">
                    {r.outletName ??
                      (r.outletId ? `Outlet #${r.outletId}` : "Unassigned")}
                  </p>
                </div>
                <Badge
                  className={
                    r.status === "available"
                      ? "bg-[#E5F2E9] text-[#2F6947] border-[#BDE0C8]"
                      : r.status === "busy"
                        ? "bg-[#FBF0D5] text-[#8A5D10]"
                        : "bg-[#F6F0E8] text-[#706356]"
                  }
                >
                  {r.status}
                </Badge>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-[#6F6257]">
                  {r.totalDeliveries} deliveries · ⭐ {r.rating}
                </span>
                <Select
                  value={r.status}
                  onValueChange={(v: any) =>
                    setStatus.mutate({ id: r.id, status: v })
                  }
                >
                  <SelectTrigger className="h-7 w-[120px] bg-[#FCFAF6] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="available">Available</SelectItem>
                    <SelectItem value="busy">Busy</SelectItem>
                    <SelectItem value="offline">Offline</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {r.activeDelivery && (
                <p className="mt-2 rounded-lg bg-[#FFF7ED] px-2 py-1 text-[11px] text-[#8A5D10]">
                  Active delivery #{r.activeDelivery.id} —{" "}
                  {r.activeDelivery.status}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#FCFAF6]">
          <DialogHeader>
            <DialogTitle>New rider</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="space-y-1">
              <span className="text-xs font-bold">Outlet</span>
              <Select
                value={form.outletId}
                onValueChange={v => setForm({ ...form, outletId: v })}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {outlets.data?.items.map((o: any) => (
                    <SelectItem key={o.id} value={String(o.id)}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Name</span>
              <Input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Phone</span>
              <Input
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                className="bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Vehicle</span>
              <Select
                value={form.vehicle}
                onValueChange={v => setForm({ ...form, vehicle: v as any })}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bike">Bike</SelectItem>
                  <SelectItem value="scooter">Scooter</SelectItem>
                  <SelectItem value="bicycle">Bicycle</SelectItem>
                  <SelectItem value="car">Car</SelectItem>
                  <SelectItem value="walk">Walk</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!form.name.trim() || !form.phone.trim())
                  return toast.error("Name & phone required");
                if (!form.outletId) return toast.error("Outlet required");
                create.mutate({
                  outletId: Number(form.outletId),
                  name: form.name.trim(),
                  phone: form.phone.trim(),
                  vehicle: form.vehicle,
                  status: form.status,
                });
              }}
              disabled={create.isPending}
              className="bg-[#211B18] text-white"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function PerformanceTab({ outletId }: { outletId: number | null }) {
  const q = trpc.delivery.performance.useQuery(
    outletId ? { outletId } : undefined
  );
  if (q.isLoading)
    return (
      <div className="grid place-items-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
      </div>
    );
  if (q.isError)
    return (
      <p className="text-sm text-[#8D5145]">
        {String((q.error as any)?.message)}
      </p>
    );
  const raw = q.data as any;
  // Defensive: mock may return [] or null; coerce to expected shape
  const d =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw
      : { total: 0, delivered: 0, failed: 0, deliveryRate: 0, avgMinutes: 0 };
  const deliveryRate = Number(d.deliveryRate ?? 0);
  const avgMinutes = Number(d.avgMinutes ?? 0);
  return (
    <section className="grid gap-3 sm:grid-cols-4">
      <div className="rounded-xl border border-[#D6CABD] bg-[#FCFAF6] p-4 text-center">
        <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
          Total
        </p>
        <p className="mt-1 text-2xl font-extrabold">{Number(d.total ?? 0)}</p>
      </div>
      <div className="rounded-xl border border-[#D6CABD] bg-[#FCFAF6] p-4 text-center">
        <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
          Delivered
        </p>
        <p className="mt-1 text-2xl font-extrabold text-[#2F6947]">
          {Number(d.delivered ?? 0)}
        </p>
      </div>
      <div className="rounded-xl border border-[#D6CABD] bg-[#FCFAF6] p-4 text-center">
        <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
          Rate
        </p>
        <p className="mt-1 text-2xl font-extrabold">
          {deliveryRate.toFixed(1)}%
        </p>
      </div>
      <div className="rounded-xl border border-[#D6CABD] bg-[#FCFAF6] p-4 text-center">
        <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
          Avg time
        </p>
        <p className="mt-1 text-2xl font-extrabold">
          {avgMinutes.toFixed(1)} min
        </p>
      </div>
    </section>
  );
}

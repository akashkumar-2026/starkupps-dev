import { inr } from "@/utils/format";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/shared/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/api/trpc";
import { useOutlet } from "@/state/outlet-provider";
import {
  Download,
  Loader2,
  Pause,
  Archive,
  Plus,
  Search,
  Ticket,
  Eye,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

function dateRangeLabel(start: any, end: any) {
  if (!start && !end) return "No validity limit";
  const s = start ? new Date(start).toLocaleDateString("en-IN") : "—";
  const e = end ? new Date(end).toLocaleDateString("en-IN") : "—";
  return `${s} → ${e}`;
}

export default function CouponsHub({ detailId }: { detailId?: number }) {
  const [location, setLocation] = useLocation();
  if (detailId)
    return (
      <CouponDetail id={detailId} onBack={() => setLocation("/coupons")} />
    );
  if (location === "/coupons/new")
    return <CouponCreatePage onBack={() => setLocation("/coupons")} />;
  return <CouponsList />;
}

function CouponsList() {
  const [, setLocation] = useLocation();
  const { selectedId: outletId } = useOutlet();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [discountType, setDiscountType] = useState("");
  const [eligibility, setEligibility] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [cursor, setCursor] = useState<number | undefined>();
  const [history, setHistory] = useState<Array<number | undefined>>([]);
  useEffect(() => {
    setCursor(undefined);
    setHistory([]);
  }, [search, status, discountType, eligibility, outletId]);
  const input = useMemo(
    () => ({
      search: search.trim() || undefined,
      status: (status || undefined) as any,
      discountType: (discountType || undefined) as any,
      outletId: outletId ?? undefined,
      customerEligibility: (eligibility || undefined) as any,
      limit: 20,
      cursor,
    }),
    [search, status, discountType, outletId, eligibility, cursor]
  );
  const q = trpc.coupons.list.useQuery(input);
  const kpi = trpc.coupons.kpi.useQuery(undefined, { staleTime: 30_000 });
  const isEmpty =
    !q.isLoading &&
    !q.isError &&
    (q.data?.items.length ?? 0) === 0 &&
    !search &&
    !status &&
    !discountType &&
    !eligibility;

  return (
    <>
      <section className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#A83825]">
            <span className="h-px w-7 bg-[#E2533C]" />
            Coupons
          </p>
          <h2 className="text-3xl font-extrabold tracking-[-0.055em] md:text-[38px]">
            Create and manage promotional discount codes.
          </h2>
          <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-[#75695E]">
            Coupons are a core promotion system — who, where, what, when, how
            many times, how much, stacking, and audit. All calculations are
            server-authoritative.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="bg-[#211B18] text-xs font-bold text-white hover:bg-[#3A2D27]"
        >
          <Plus className="mr-1 h-4 w-4" />
          Create Coupon
        </Button>
      </section>

      {/* KPI */}
      {kpi.isLoading ? (
        <div className="grid min-h-[90px] place-items-center rounded-xl border border-[#D5C8BA] bg-[#FCFAF6]">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : kpi.isError ? null : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[12px] border border-[#DAD0C5] bg-[#FCFAF6] p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8B7E71]">
              Active Coupons
            </p>
            <p className="mt-2 text-2xl font-extrabold">
              {kpi.data?.active ?? 0}
            </p>
            <p className="text-xs text-[#8B7E71]">
              Scheduled {kpi.data?.scheduled ?? 0} • Expired{" "}
              {kpi.data?.expired ?? 0}
            </p>
          </div>
          <div className="rounded-[12px] border border-[#DAD0C5] bg-[#FCFAF6] p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8B7E71]">
              Used Today
            </p>
            <p className="mt-2 text-2xl font-extrabold">
              {kpi.data?.usedToday ?? 0}
            </p>
            <p className="text-xs text-[#8B7E71]">
              Total {kpi.data?.totalRedemptions ?? 0} redemptions
            </p>
          </div>
          <div className="rounded-[12px] border border-[#DAD0C5] bg-[#FCFAF6] p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8B7E71]">
              Discount Given
            </p>
            <p className="mt-2 text-2xl font-extrabold">
              {inr(kpi.data?.discountGiven ?? 0)}
            </p>
            <p className="text-xs text-[#8B7E71]">Across all outlets</p>
          </div>
          <div className="rounded-[12px] border border-[#DAD0C5] bg-[#FCFAF6] p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8B7E71]">
              Most Used
            </p>
            <p className="mt-2 text-sm font-extrabold truncate">
              {kpi.data?.mostUsed?.code ?? "—"}
            </p>
            <p className="text-xs text-[#8B7E71]">
              {kpi.data?.mostUsed
                ? `${kpi.data.mostUsed.count} uses`
                : "No usage yet"}
            </p>
          </div>
        </div>
      )}

      {/* Search + Filters + Export */}
      <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#8E8174]" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search coupons..."
            className="h-10 border-[#DCCFC2] bg-[#FCFAF6] pl-9 text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-[140px] border-[#DCCFC2] bg-white text-xs">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="exhausted">Exhausted</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <Select value={discountType} onValueChange={setDiscountType}>
            <SelectTrigger className="h-9 w-[150px] border-[#DCCFC2] bg-white text-xs">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All types</SelectItem>
              <SelectItem value="percentage">Percentage</SelectItem>
              <SelectItem value="fixed">Fixed</SelectItem>
              <SelectItem value="free_delivery">Free Delivery</SelectItem>
            </SelectContent>
          </Select>
          <Select value={eligibility} onValueChange={setEligibility}>
            <SelectTrigger className="h-9 w-[150px] border-[#DCCFC2] bg-white text-xs">
              <SelectValue placeholder="All customers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="returning">Returning</SelectItem>
              <SelectItem value="vip">VIP</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            className="h-9 border-[#DCCFC2] bg-white text-xs"
            onClick={() => {
              if (!q.data?.items.length)
                return toast.error("No coupons to export");
              const rows = q.data.items;
              const header = [
                "Code",
                "Name",
                "Discount",
                "Usage",
                "Status",
                "Created",
              ];
              const csv = [
                header.join(","),
                ...rows.map((r: any) =>
                  [
                    r.code,
                    `"${r.name.replaceAll('"', '""')}"`,
                    `${r.discountType}:${r.discountValue}`,
                    `${r.usedCount}/${r.usageLimit ?? "∞"}`,
                    r.derivedStatus,
                    new Date(r.createdAt).toISOString(),
                  ].join(",")
                ),
              ].join("\n");
              const url = URL.createObjectURL(
                new Blob([csv], { type: "text/csv" })
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "coupons.csv";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download className="mr-1 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Table */}
      {q.isLoading ? (
        <div className="mt-5 grid place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-10">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : q.isError ? (
        <div className="mt-5 rounded-[14px] border border-[#F1C9BD] bg-[#FFF8F5] p-5 text-sm text-[#8D5145]">
          {String((q.error as any).message)}{" "}
          <Button
            variant="outline"
            className="ml-2 h-7 text-xs"
            onClick={() => q.refetch()}
          >
            Try Again
          </Button>
        </div>
      ) : isEmpty ? (
        <div className="mt-5 grid place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-10 text-center">
          <Ticket className="mx-auto h-10 w-10 text-[#A39486]" />
          <h3 className="mt-4 text-lg font-extrabold">
            No coupons created yet.
          </h3>
          <p className="mt-2 max-w-md text-xs leading-5 text-[#827568]">
            Create your first coupon to start offering targeted discounts.
          </p>
          <Button
            onClick={() => setCreateOpen(true)}
            className="mt-4 bg-[#211B18] text-xs text-white"
          >
            Create Coupon
          </Button>
        </div>
      ) : !q.data?.items.length ? (
        <div className="mt-5 grid place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-8 text-center">
          <p className="text-sm font-bold">No coupons match filters.</p>
          <p className="text-xs text-[#827568]">Try clearing filters.</p>
          <Button
            variant="outline"
            className="mt-3 h-7 text-xs"
            onClick={() => {
              setSearch("");
              setStatus("");
              setDiscountType("");
              setEligibility("");
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <section className="mt-5 overflow-hidden rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6]">
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-left">
              <thead className="border-b bg-[#F7F2EB]">
                <tr>
                  {[
                    "Coupon",
                    "Code",
                    "Discount",
                    "Usage",
                    "Validity",
                    "Applicable To",
                    "Status",
                    "Created",
                    "",
                  ].map(h => (
                    <th
                      key={h}
                      className="px-3 py-3 font-mono text-[9px] uppercase tracking-[0.11em] text-[#87796C]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {q.data.items.map((c: any) => (
                  <tr key={c.id} className="hover:bg-white">
                    <td className="px-3 py-3">
                      <p className="text-xs font-extrabold">{c.name || "—"}</p>
                      <p className="text-[11px] text-[#8B7E71] truncate max-w-[180px]">
                        {c.description ?? ""}
                      </p>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs font-bold">
                      {c.code}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {c.discountType === "percentage"
                        ? `${c.discountValue}%${c.maximumDiscount ? ` up to ${inr(c.maximumDiscount)}` : ""}`
                        : c.discountType === "fixed"
                          ? inr(c.discountValue)
                          : "Free Delivery"}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {c.usedCount} / {c.usageLimit ?? "∞"}
                    </td>
                    <td className="px-3 py-3 text-xs text-[#6F6257]">
                      {dateRangeLabel(c.startAt, c.endAt)}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {c.customerEligibility !== "all"
                        ? c.customerEligibility
                        : c.applicableOutlets?.length
                          ? `${c.applicableOutlets.length} outlets`
                          : "All"}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${c.derivedStatus === "active" ? "border-[#BDE0C8] bg-[#E5F2E9] text-[#2F6947]" : c.derivedStatus === "scheduled" ? "border-[#E9D49D] bg-[#FDF3D9] text-[#8A5D10]" : c.derivedStatus === "paused" ? "border-[#F3C5B9] bg-[#FBE4DD] text-[#A83825]" : c.derivedStatus === "expired" || c.derivedStatus === "exhausted" ? "border-[#E3D9CE] bg-[#F6F0E8] text-[#706356]" : "border-[#D6CABD] bg-white text-[#8B7E71]"}`}
                      >
                        {c.derivedStatus}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-[#6F6257]">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-3">
                      <Button
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => setLocation(`/coupons/${c.id}`)}
                      >
                        <Eye className="mr-1 h-3 w-3" />
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {(q.data?.nextCursor !== undefined || history.length > 0) && (
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="outline"
            className="h-9 text-xs"
            disabled={!history.length}
            onClick={() => {
              const prev = history.at(-1);
              setHistory(h => h.slice(0, -1));
              setCursor(prev);
            }}
          >
            Newer
          </Button>
          <Button
            variant="outline"
            className="h-9 text-xs"
            disabled={!q.data?.nextCursor}
            onClick={() => {
              if (q.data?.nextCursor) {
                setHistory(h => [...h, cursor]);
                setCursor(q.data.nextCursor);
              }
            }}
          >
            Older
          </Button>
        </div>
      )}
      <CouponCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function CouponCreatePage({ onBack }: { onBack: () => void }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    setOpen(true);
  }, []);
  return (
    <CouponCreateDialog
      open={open}
      onOpenChange={o => {
        if (!o) onBack();
        setOpen(o);
      }}
    />
  );
}

function CouponCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const outlets = trpc.outlets.list.useQuery({ limit: 100 } as any);
  const menu = trpc.admin.menu.list.useQuery({ limit: 100 } as any);
  const [form, setForm] = useState<any>({
    name: "",
    code: "",
    description: "",
    status: "active",
    discountType: "percentage",
    discountValue: "",
    minimumOrder: "0",
    maximumDiscount: "",
    startAt: "",
    endAt: "",
    timezone: "Asia/Kolkata",
    usageLimit: "",
    perCustomerLimit: "1",
    priority: "0",
    allowStacking: false,
    paymentMethods: [] as string[],
    orderTypes: [] as string[],
    customerEligibility: "all",
    applicableOutlets: [] as number[],
    applicableProducts: [] as number[],
    applicableCategories: [] as number[],
    excludeProducts: [] as number[],
    excludeCategories: [] as number[],
  });
  const create = trpc.coupons.create.useMutation({
    onSuccess: () => {
      toast.success("Coupon created successfully.");
      onOpenChange(false);
      setForm({
        name: "",
        code: "",
        description: "",
        status: "active",
        discountType: "percentage",
        discountValue: "",
        minimumOrder: "0",
        maximumDiscount: "",
        startAt: "",
        endAt: "",
        timezone: "Asia/Kolkata",
        usageLimit: "",
        perCustomerLimit: "1",
        priority: "0",
        allowStacking: false,
        paymentMethods: [],
        orderTypes: [],
        customerEligibility: "all",
        applicableOutlets: [],
        applicableProducts: [],
        applicableCategories: [],
        excludeProducts: [],
        excludeCategories: [],
      });
      void utils.coupons.list.invalidate();
      void utils.coupons.kpi.invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Could not create coupon"),
  });
  const previewDiscount = useMemo(() => {
    const v = Number(form.discountValue || 0);
    if (form.discountType === "percentage")
      return `${v}%${form.maximumDiscount ? ` up to ${inr(Number(form.maximumDiscount))}` : ""}`;
    if (form.discountType === "fixed") return inr(v);
    return "Free Delivery";
  }, [form.discountType, form.discountValue, form.maximumDiscount]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.name.trim() || !form.code.trim())
      return toast.error("Name and code required");
    if (form.discountType !== "free_delivery" && !form.discountValue)
      return toast.error("Discount value required");
    const payload: any = {
      name: form.name.trim(),
      code: form.code.trim(),
      description: form.description.trim() || null,
      status: form.status,
      discountType: form.discountType,
      discountValue:
        form.discountType === "free_delivery" ? 0 : Number(form.discountValue),
      minimumOrder: Number(form.minimumOrder || 0),
      maximumDiscount: form.maximumDiscount
        ? Number(form.maximumDiscount)
        : null,
      startAt: form.startAt ? new Date(form.startAt) : null,
      endAt: form.endAt ? new Date(form.endAt) : null,
      timezone: form.timezone,
      usageLimit: form.usageLimit ? Number(form.usageLimit) : null,
      perCustomerLimit: form.perCustomerLimit
        ? Number(form.perCustomerLimit)
        : null,
      priority: Number(form.priority || 0),
      allowStacking: form.allowStacking,
      paymentMethods: form.paymentMethods.length ? form.paymentMethods : null,
      orderTypes: form.orderTypes.length ? form.orderTypes : null,
      customerEligibility: form.customerEligibility,
      customerEligibilityValue: null,
      applicableOutlets: form.applicableOutlets.length
        ? form.applicableOutlets
        : null,
      applicableProducts: form.applicableProducts.length
        ? form.applicableProducts
        : null,
      applicableCategories: form.applicableCategories.length
        ? form.applicableCategories
        : null,
      excludeProducts: form.excludeProducts.length
        ? form.excludeProducts
        : null,
      excludeCategories: form.excludeCategories.length
        ? form.excludeCategories
        : null,
    };
    create.mutate(payload);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="3xl"
      title="Create Coupon"
      description="Centralized promotion eligibility — who, where, what, when, how many, how much."
      onSubmit={submit}
      submitLabel={
        create.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          "Create Coupon"
        )
      }
      submitPending={create.isPending}
      isDirty={form.name.trim() !== "" || form.code.trim() !== ""}
      formClassName="space-y-6"
    >
      <div className="space-y-6">
        {/* Preview */}
        <div className="rounded-xl border border-[#E4DCD1] bg-white p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8B7E71]">
            Customer view
          </p>
          <p className="mt-1 text-lg font-extrabold">
            {form.code || "CODE"} • {previewDiscount}
          </p>
          <p className="text-xs text-[#6F6257]">
            {form.minimumOrder && Number(form.minimumOrder) > 0
              ? `Minimum order ${inr(Number(form.minimumOrder))}`
              : "No minimum"}{" "}
            {form.endAt
              ? `• Valid until ${new Date(form.endAt).toLocaleDateString()}`
              : ""}
          </p>
        </div>

        <section>
          <h4 className="border-b border-[#E7DED4] pb-2 text-xs font-extrabold uppercase tracking-[0.1em] text-[#A83825]">
            Basic Information
          </h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-bold">Coupon Name *</span>
              <Input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Welcome Offer"
                className="bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Coupon Code *</span>
              <Input
                value={form.code}
                onChange={e =>
                  setForm({ ...form, code: e.target.value.toUpperCase() })
                }
                placeholder="WELCOME50"
                className="bg-white"
              />
            </label>
            <label className="col-span-2 space-y-1">
              <span className="text-xs font-bold">Description</span>
              <Textarea
                value={form.description}
                onChange={e =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="50% off for first-time customers."
                className="bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Status</span>
              <Select
                value={form.status}
                onValueChange={v => setForm({ ...form, status: v })}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
        </section>

        <section>
          <h4 className="border-b border-[#E7DED4] pb-2 text-xs font-extrabold uppercase tracking-[0.1em] text-[#A83825]">
            Discount
          </h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-bold">Discount Type</span>
              <Select
                value={form.discountType}
                onValueChange={v => setForm({ ...form, discountType: v })}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">
                    Percentage Discount
                  </SelectItem>
                  <SelectItem value="fixed">Fixed Amount</SelectItem>
                  <SelectItem value="free_delivery">Free Delivery</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Discount Value *</span>
              <Input
                type="number"
                value={form.discountValue}
                onChange={e =>
                  setForm({ ...form, discountValue: e.target.value })
                }
                placeholder="20"
                className="bg-white"
              />
            </label>
            {form.discountType === "percentage" && (
              <label className="space-y-1">
                <span className="text-xs font-bold">Maximum Discount (₹)</span>
                <Input
                  type="number"
                  value={form.maximumDiscount}
                  onChange={e =>
                    setForm({ ...form, maximumDiscount: e.target.value })
                  }
                  placeholder="100"
                  className="bg-white"
                />
              </label>
            )}
            <label className="space-y-1">
              <span className="text-xs font-bold">Minimum Order Value (₹)</span>
              <Input
                type="number"
                value={form.minimumOrder}
                onChange={e =>
                  setForm({ ...form, minimumOrder: e.target.value })
                }
                placeholder="299"
                className="bg-white"
              />
            </label>
          </div>
        </section>

        <section>
          <h4 className="border-b border-[#E7DED4] pb-2 text-xs font-extrabold uppercase tracking-[0.1em] text-[#A83825]">
            Eligibility
          </h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-bold">Customers</span>
              <Select
                value={form.customerEligibility}
                onValueChange={v =>
                  setForm({ ...form, customerEligibility: v })
                }
              >
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Customers</SelectItem>
                  <SelectItem value="new">New Customers (0 orders)</SelectItem>
                  <SelectItem value="returning">
                    Returning (1+ orders)
                  </SelectItem>
                  <SelectItem value="vip">VIP</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Outlet Targeting</span>
              <div className="scrollbar-none rounded-md border border-[#DCCFC2] bg-white p-2 max-h-28 overflow-y-auto">
                {outlets.data?.items.map((o: any) => (
                  <label key={o.id} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={form.applicableOutlets.includes(o.id)}
                      onChange={e =>
                        setForm({
                          ...form,
                          applicableOutlets: e.target.checked
                            ? [...form.applicableOutlets, o.id]
                            : form.applicableOutlets.filter(
                                (id: number) => id !== o.id
                              ),
                        })
                      }
                    />
                    {o.name} — {o.code}
                  </label>
                )) ?? (
                  <span className="text-xs text-[#8B7E71]">
                    All outlets if none selected
                  </span>
                )}
              </div>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Order Types</span>
              <div className="flex gap-2 text-xs">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={form.orderTypes.includes("delivery")}
                    onChange={e =>
                      setForm({
                        ...form,
                        orderTypes: e.target.checked
                          ? [...form.orderTypes, "delivery"]
                          : form.orderTypes.filter(
                              (v: string) => v !== "delivery"
                            ),
                      })
                    }
                  />
                  Delivery
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={form.orderTypes.includes("takeaway")}
                    onChange={e =>
                      setForm({
                        ...form,
                        orderTypes: e.target.checked
                          ? [...form.orderTypes, "takeaway"]
                          : form.orderTypes.filter(
                              (v: string) => v !== "takeaway"
                            ),
                      })
                    }
                  />
                  Takeaway
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={form.orderTypes.includes("dine_in")}
                    onChange={e =>
                      setForm({
                        ...form,
                        orderTypes: e.target.checked
                          ? [...form.orderTypes, "dine_in"]
                          : form.orderTypes.filter(
                              (v: string) => v !== "dine_in"
                            ),
                      })
                    }
                  />
                  Dine-in
                </label>
              </div>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Payment Methods</span>
              <div className="flex flex-wrap gap-2 text-xs">
                {["cash", "upi", "card", "online"].map(pm => (
                  <label key={pm} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={form.paymentMethods.includes(pm)}
                      onChange={e =>
                        setForm({
                          ...form,
                          paymentMethods: e.target.checked
                            ? [...form.paymentMethods, pm]
                            : form.paymentMethods.filter(
                                (v: string) => v !== pm
                              ),
                        })
                      }
                    />
                    {pm}
                  </label>
                ))}
              </div>
            </label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-bold">Include Products</span>
              <div className="scrollbar-none rounded-md border bg-white p-2 max-h-24 overflow-y-auto text-xs">
                {menu.data?.items.slice(0, 50).map((p: any) => (
                  <label key={p.id} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={form.applicableProducts.includes(p.id)}
                      onChange={e =>
                        setForm({
                          ...form,
                          applicableProducts: e.target.checked
                            ? [...form.applicableProducts, p.id]
                            : form.applicableProducts.filter(
                                (id: number) => id !== p.id
                              ),
                        })
                      }
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Exclude Products</span>
              <div className="scrollbar-none rounded-md border bg-white p-2 max-h-24 overflow-y-auto text-xs">
                {menu.data?.items.slice(0, 50).map((p: any) => (
                  <label key={p.id} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={form.excludeProducts.includes(p.id)}
                      onChange={e =>
                        setForm({
                          ...form,
                          excludeProducts: e.target.checked
                            ? [...form.excludeProducts, p.id]
                            : form.excludeProducts.filter(
                                (id: number) => id !== p.id
                              ),
                        })
                      }
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </label>
          </div>
        </section>

        <section>
          <h4 className="border-b border-[#E7DED4] pb-2 text-xs font-extrabold uppercase tracking-[0.1em] text-[#A83825]">
            Usage
          </h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs font-bold">Total Usage Limit</span>
              <Input
                type="number"
                value={form.usageLimit}
                onChange={e => setForm({ ...form, usageLimit: e.target.value })}
                placeholder="1000"
                className="bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Per Customer Limit</span>
              <Input
                type="number"
                value={form.perCustomerLimit}
                onChange={e =>
                  setForm({ ...form, perCustomerLimit: e.target.value })
                }
                placeholder="1"
                className="bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Priority</span>
              <Input
                type="number"
                value={form.priority}
                onChange={e => setForm({ ...form, priority: e.target.value })}
                placeholder="0"
                className="bg-white"
              />
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs font-bold">
            <input
              type="checkbox"
              checked={form.allowStacking}
              onChange={e =>
                setForm({ ...form, allowStacking: e.target.checked })
              }
            />
            Allow stacking with other coupons
          </label>
        </section>

        <section>
          <h4 className="border-b border-[#E7DED4] pb-2 text-xs font-extrabold uppercase tracking-[0.1em] text-[#A83825]">
            Validity
          </h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs font-bold">Start Date</span>
              <Input
                type="datetime-local"
                value={form.startAt}
                onChange={e => setForm({ ...form, startAt: e.target.value })}
                className="bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">End Date</span>
              <Input
                type="datetime-local"
                value={form.endAt}
                onChange={e => setForm({ ...form, endAt: e.target.value })}
                className="bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Timezone</span>
              <Input
                value={form.timezone}
                onChange={e => setForm({ ...form, timezone: e.target.value })}
                placeholder="Asia/Kolkata"
                className="bg-white"
              />
            </label>
          </div>
        </section>
      </div>
    </FormDialog>
  );
}

function CouponDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const q = trpc.coupons.byId.useQuery({ id });
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<
    "overview" | "redemptions" | "analytics" | "activity"
  >("overview");
  const setStatus = trpc.coupons.setStatus.useMutation({
    onSuccess: () => {
      toast.success("Status updated");
      void q.refetch();
      void utils.coupons.list.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = trpc.coupons.remove.useMutation({
    onSuccess: () => {
      toast.success("Coupon deleted");
      onBack();
      void utils.coupons.list.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });
  if (q.isLoading)
    return (
      <div className="grid place-items-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div className="rounded-[14px] border border-[#F1C9BD] bg-[#FFF8F5] p-5 text-sm">
        Coupon not found{" "}
        <Button variant="outline" className="ml-2 h-7 text-xs" onClick={onBack}>
          Back
        </Button>
      </div>
    );
  const { coupon, analytics } = q.data as any;
  const stats = analytics ?? {
    totalRedemptions: 0,
    discount: 0,
    net: 0,
    aov: 0,
    newCustomers: 0,
    repeatRate: 0,
  };
  return (
    <>
      <Button variant="ghost" onClick={onBack} className="mb-4 px-0 text-xs">
        ← Coupons
      </Button>
      <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#A83825]">
              {coupon.code} • {coupon.discountType}
            </p>
            <h2 className="text-2xl font-extrabold">
              {coupon.name || coupon.code}
            </h2>
            <p className="mt-1 text-xs text-[#776A5E]">
              {coupon.description ?? "No description"} • Priority{" "}
              {coupon.priority} •{" "}
              {coupon.allowStacking ? "Stackable" : "No stacking"}
            </p>
          </div>
          <span
            className={`rounded-full border px-3 py-1 text-xs font-bold ${coupon.derivedStatus === "active" ? "border-[#BDE0C8] bg-[#E5F2E9] text-[#2F6947]" : coupon.derivedStatus === "paused" ? "border-[#F3C5B9] bg-[#FBE4DD] text-[#A83825]" : "border-[#E3D9CE] bg-white text-[#8B7E71]"}`}
          >
            {coupon.derivedStatus}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border bg-white p-3 text-center">
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
              Discount
            </p>
            <p className="mt-1 text-sm font-extrabold">
              {coupon.discountType === "percentage"
                ? `${coupon.discountValue}%`
                : coupon.discountType === "fixed"
                  ? inr(coupon.discountValue)
                  : "Free Delivery"}
            </p>
          </div>
          <div className="rounded-xl border bg-white p-3 text-center">
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
              Usage
            </p>
            <p className="mt-1 text-sm font-extrabold">
              {coupon.usedCount} / {coupon.usageLimit ?? "∞"}
            </p>
          </div>
          <div className="rounded-xl border bg-white p-3 text-center">
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
              Validity
            </p>
            <p className="mt-1 text-xs font-bold">
              {dateRangeLabel(coupon.startAt, coupon.endAt)}
            </p>
          </div>
          <div className="rounded-xl border bg-white p-3 text-center">
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
              Customers
            </p>
            <p className="mt-1 text-sm font-extrabold">
              {coupon.customerEligibility}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {coupon.derivedStatus === "active" && (
            <Button
              className="h-8 bg-[#E2533C] text-xs text-white"
              disabled={setStatus.isPending || remove.isPending}
              onClick={() => setStatus.mutate({ id, status: "paused" })}
            >
              <Pause className="mr-1 h-3 w-3" />
              Pause
            </Button>
          )}
          {coupon.derivedStatus === "paused" && (
            <Button
              className="h-8 bg-[#211B18] text-xs text-white"
              disabled={setStatus.isPending || remove.isPending}
              onClick={() => setStatus.mutate({ id, status: "active" })}
            >
              Activate
            </Button>
          )}
          <Button
            variant="outline"
            className="h-8 text-xs"
            disabled={setStatus.isPending || remove.isPending}
            onClick={() => setStatus.mutate({ id, status: "archived" })}
          >
            <Archive className="mr-1 h-3 w-3" />
            Archive
          </Button>
          <Button
            variant="outline"
            className="h-8 border-[#F1C9BD] bg-white text-xs text-[#A83825]"
            disabled={setStatus.isPending || remove.isPending}
            onClick={() => {
              if (
                confirm(
                  `Delete ${coupon.code}? Only unused coupons can be deleted.`
                )
              )
                remove.mutate({ id });
            }}
          >
            <Trash2 className="mr-1 h-3 w-3" />
            Delete
          </Button>
        </div>
        <div className="mt-5 flex gap-1 rounded-xl border bg-[#EEE9E1] p-1 w-fit">
          {(["overview", "redemptions", "analytics", "activity"] as const).map(
            t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold capitalize ${tab === t ? "bg-white shadow-sm" : "text-[#766A5F]"}`}
              >
                {t}
              </button>
            )
          )}
        </div>
      </section>

      <div className="mt-5">
        {tab === "overview" && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[14px] border bg-[#FCFAF6] p-5">
              <h3 className="text-sm font-extrabold">Eligibility</h3>
              <ul className="mt-2 space-y-1 text-xs text-[#5A4E45]">
                <li>
                  Outlets:{" "}
                  {coupon.applicableOutlets?.length
                    ? coupon.applicableOutlets.join(", ")
                    : "All"}
                </li>
                <li>
                  Products:{" "}
                  {coupon.applicableProducts?.length
                    ? coupon.applicableProducts.join(", ")
                    : "All"}
                </li>
                <li>
                  Categories:{" "}
                  {coupon.applicableCategories?.length
                    ? coupon.applicableCategories.join(", ")
                    : "All"}
                </li>
                <li>
                  Exclude:{" "}
                  {coupon.excludeProducts?.length ||
                  coupon.excludeCategories?.length
                    ? `${coupon.excludeProducts?.length ?? 0} products, ${coupon.excludeCategories?.length ?? 0} categories`
                    : "None"}
                </li>
                <li>
                  Order types:{" "}
                  {coupon.orderTypes?.length
                    ? coupon.orderTypes.join(", ")
                    : "All"}
                </li>
                <li>
                  Payment:{" "}
                  {coupon.paymentMethods?.length
                    ? coupon.paymentMethods.join(", ")
                    : "All"}
                </li>
              </ul>
            </div>
            <div className="rounded-[14px] border bg-[#FCFAF6] p-5">
              <h3 className="text-sm font-extrabold">Usage</h3>
              <p className="mt-2 text-xs">
                Total: {coupon.usedCount} / {coupon.usageLimit ?? "Unlimited"} •
                Per customer: {coupon.perCustomerLimit ?? "Unlimited"}
              </p>
              <p className="mt-1 text-xs">
                Min order: {inr(coupon.minimumOrder)}{" "}
                {coupon.maximumDiscount
                  ? `• Max discount: ${inr(coupon.maximumDiscount)}`
                  : ""}
              </p>
            </div>
          </div>
        )}
        {tab === "redemptions" && <RedemptionsTab couponId={id} />}
        {tab === "analytics" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-[#FCFAF6] p-4 text-center">
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#8B7E71]">
                Redemptions
              </p>
              <p className="mt-1 text-2xl font-extrabold">
                {stats.totalRedemptions}
              </p>
            </div>
            <div className="rounded-xl border bg-[#FCFAF6] p-4 text-center">
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#8B7E71]">
                Discount
              </p>
              <p className="mt-1 text-xl font-extrabold">
                {inr(stats.discount)}
              </p>
            </div>
            <div className="rounded-xl border bg-[#FCFAF6] p-4 text-center">
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#8B7E71]">
                Net Sales
              </p>
              <p className="mt-1 text-xl font-extrabold">{inr(stats.net)}</p>
            </div>
            <div className="rounded-xl border bg-[#FCFAF6] p-4 text-center">
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#8B7E71]">
                AOV
              </p>
              <p className="mt-1 text-xl font-extrabold">{inr(stats.aov)}</p>
            </div>
            <div className="rounded-xl border bg-[#FCFAF6] p-4 text-center">
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#8B7E71]">
                New Customers
              </p>
              <p className="mt-1 text-2xl font-extrabold">
                {stats.newCustomers}
              </p>
            </div>
            <div className="rounded-xl border bg-[#FCFAF6] p-4 text-center">
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#8B7E71]">
                Repeat Rate
              </p>
              <p className="mt-1 text-xl font-extrabold">
                {Number(stats.repeatRate ?? 0).toFixed(1)}%
              </p>
            </div>
          </div>
        )}
        {tab === "activity" && (
          <div className="rounded-[14px] border bg-[#FCFAF6] p-5">
            <p className="text-xs text-[#8B7E71]">
              Audit: coupon created/updated/paused/archived are recorded in
              Audit Logs. Filter by entityType=coupon.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function RedemptionsTab({ couponId }: { couponId: number }) {
  const q = trpc.coupons.redemptions.list.useQuery({ couponId, limit: 20 });
  if (q.isLoading)
    return (
      <div className="grid place-items-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
      </div>
    );
  if (q.isError)
    return (
      <p className="text-sm text-[#8D5145]">
        {String((q.error as any).message)}
      </p>
    );
  if (!q.data?.items.length)
    return (
      <div className="grid place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-8 text-center">
        <p className="text-sm font-bold">No redemptions yet.</p>
        <p className="text-xs text-[#827568]">This coupon has not been used.</p>
      </div>
    );
  return (
    <div className="overflow-hidden rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6]">
      <div className="overflow-x-auto">
        <table className="min-w-[800px] w-full text-left">
          <thead className="border-b bg-[#F7F2EB]">
            <tr>
              {[
                "Date",
                "Customer",
                "Order",
                "Outlet",
                "Discount",
                "Status",
              ].map(h => (
                <th
                  key={h}
                  className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.11em] text-[#8B7E71]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.data.items.map((r: any) => (
              <tr key={r.id} className="text-xs">
                <td className="px-3 py-3 text-[#6F6257]">
                  {new Date(r.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-3 font-bold">
                  {r.customerName ?? "—"}
                  <p className="text-[11px] font-normal text-[#8B7E71]">
                    {r.customerPhone ?? ""}
                  </p>
                </td>
                <td className="px-3 py-3">
                  {r.orderNumber ? `#${r.orderNumber}` : `#${r.orderId}`}
                </td>
                <td className="px-3 py-3">
                  {r.outletName ?? (r.outletId ? `Outlet #${r.outletId}` : "—")}
                </td>
                <td className="px-3 py-3 font-mono">{inr(r.discountAmount)}</td>
                <td className="px-3 py-3">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${r.status === "applied" ? "border-[#BDE0C8] bg-[#E5F2E9] text-[#2F6947]" : "border-[#F3C5B9] bg-[#FBE4DD] text-[#A83825]"}`}
                  >
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

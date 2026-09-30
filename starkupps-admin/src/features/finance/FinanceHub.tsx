import { inr } from "@/utils/format";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { trpc } from "@/api/trpc";
import { useOutlet } from "@/state/outlet-provider";
import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

const expenseSchema = z.object({
  outletId: z.string().optional(),
  category: z.enum(["ingredients", "rent", "electricity", "salaries", "other"]),
  amount: z
    .string()
    .trim()
    .refine(
      v => Number.isFinite(Number(v)) && Number(v) > 0,
      "Enter a valid amount"
    ),
  date: z.string().min(1, "Date is required"),
  vendor: z.string().trim().optional(),
  description: z.string().trim().optional(),
});
const taxSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  type: z.enum([
    "gst",
    "service_charge",
    "packaging_charge",
    "delivery_charge",
    "other",
  ]),
  rate: z
    .string()
    .trim()
    .refine(
      v => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100,
      "Rate must be between 0 and 100"
    ),
  outletId: z.string().optional(),
});

export default function FinanceHub() {
  const { selectedId } = useOutlet();
  const [tab, setTab] = useState<
    "revenue" | "transactions" | "refunds" | "expenses" | "taxes"
  >("revenue");
  return (
    <>
      <section className="mb-6">
        <p className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#A83825]">
          <span className="h-px w-7 bg-[#E2533C]" />
          Finance
        </p>
        <h2 className="text-3xl font-extrabold tracking-[-0.055em]">
          Auditable money, outlet-aware.
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#75695E]">
          Revenue, transactions, refunds (idempotent + provider sync), expenses,
          taxes — all with outlet filter and server-side totals.
        </p>
        <div className="mt-4 flex gap-1 rounded-xl border border-[#E4DCD1] bg-[#EEE9E1] p-1 w-fit flex-wrap">
          {(
            ["revenue", "transactions", "refunds", "expenses", "taxes"] as const
          ).map(t => (
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
      {tab === "revenue" && <RevenueTab outletId={selectedId} />}
      {tab === "transactions" && <TransactionsTab outletId={selectedId} />}
      {tab === "refunds" && <RefundsTab />}
      {tab === "expenses" && <ExpensesTab outletId={selectedId} />}
      {tab === "taxes" && <TaxesTab />}
    </>
  );
}

function RevenueTab({ outletId }: { outletId: number | null }) {
  const q = trpc.finance.revenue.useQuery(outletId ? { outletId } : undefined);
  if (q.isLoading)
    return (
      <div className="grid place-items-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
      </div>
    );
  if (q.isError)
    return (
      <p className="text-sm text-[#8D5145]">
        {String((q.error as any)?.message)}
      </p>
    );
  const d = q.data as any;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-5">
        <div className="rounded-xl border bg-[#FCFAF6] p-4 text-center">
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
            Gross
          </p>
          <p className="mt-1 text-lg font-extrabold">{inr(d.gross)}</p>
        </div>
        <div className="rounded-xl border bg-[#FCFAF6] p-4 text-center">
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
            Discounts
          </p>
          <p className="mt-1 text-lg font-extrabold">{inr(d.discounts)}</p>
        </div>
        <div className="rounded-xl border bg-[#FCFAF6] p-4 text-center">
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
            Taxes
          </p>
          <p className="mt-1 text-lg font-extrabold">{inr(d.taxes)}</p>
        </div>
        <div className="rounded-xl border bg-[#FCFAF6] p-4 text-center">
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
            Refunds
          </p>
          <p className="mt-1 text-lg font-extrabold text-[#A83825]">
            {inr(d.refunds)}
          </p>
        </div>
        <div className="rounded-xl border bg-[#FCFAF6] p-4 text-center">
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
            Net
          </p>
          <p className="mt-1 text-lg font-extrabold text-[#2F6947]">
            {inr(d.net)}
          </p>
        </div>
      </div>
      <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
        <h3 className="text-sm font-extrabold">Daily revenue</h3>
        {!d.daily.length ? (
          <p className="mt-4 text-center text-xs text-[#827568]">
            No revenue in this outlet/date range.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b">
                <tr>
                  {["Date", "Revenue"].map(h => (
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
                {d.daily.map((row: any) => (
                  <tr key={row.date}>
                    <td className="px-3 py-2">{row.date}</td>
                    <td className="px-3 py-2 font-bold">{inr(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function TransactionsTab({ outletId }: { outletId: number | null }) {
  const q = trpc.finance.transactions.useQuery(
    outletId ? { outletId } : undefined
  );
  return (
    <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
      <h3 className="text-sm font-extrabold">Transactions</h3>
      {q.isLoading ? (
        <div className="grid place-items-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : q.isError ? (
        <p className="mt-4 text-center text-xs text-[#B83D29]">
          Transactions could not be loaded.{" "}
          <button className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : !q.data?.items.length ? (
        <p className="mt-4 text-center text-xs text-[#827568]">
          No transactions.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[800px] w-full text-left">
            <thead className="border-b bg-[#F7F2EB]">
              <tr>
                {[
                  "Txn",
                  "Order",
                  "Outlet",
                  "Method",
                  "Amount",
                  "Status",
                  "Date",
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
              {q.data.items.map((t: any) => (
                <tr key={t.id} className="text-xs">
                  <td className="px-3 py-3 font-mono">#{t.id}</td>
                  <td className="px-3 py-3">{t.orderNumber ?? t.orderId}</td>
                  <td className="px-3 py-3">
                    {t.outletName ?? t.outletId ?? "—"}
                  </td>
                  <td className="px-3 py-3">{t.method}</td>
                  <td className="px-3 py-3 font-bold">
                    {inr(Number(t.amount))}
                  </td>
                  <td className="px-3 py-3">
                    <Badge
                      className={
                        t.status === "paid"
                          ? "bg-[#E5F2E9] text-[#2F6947]"
                          : t.status === "failed"
                            ? "bg-[#FBE4DD] text-[#A83825]"
                            : "bg-[#F6F0E8]"
                      }
                    >
                      {t.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-[#6F6257]">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RefundsTab() {
  const q = trpc.finance.refunds.list.useQuery({});
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ orderId: "", amount: "", reason: "" });
  const create = trpc.finance.refunds.create.useMutation({
    onSuccess: () => {
      toast.success("Refund requested — validate then refund via provider");
      setOpen(false);
      void q.refetch();
      void utils.finance.revenue.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const update = trpc.finance.refunds.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("Refund status updated");
      void q.refetch();
      void utils.finance.revenue.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold">
          Refunds — state machine + idempotency
        </h3>
        <Button
          onClick={() => setOpen(true)}
          className="bg-[#211B18] text-xs text-white"
        >
          <Plus className="mr-1 h-3 w-3" />
          Request refund
        </Button>
      </div>
      <p className="mt-1 text-xs text-[#776A5E]">
        Requested → Validated → Refunded (provider sync) — never mark refunded
        on button click alone.
      </p>
      {q.isLoading ? (
        <div className="grid place-items-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : q.isError ? (
        <p className="mt-4 text-center text-xs text-[#B83D29]">
          Refunds could not be loaded.{" "}
          <button className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : !q.data?.length ? (
        <p className="mt-4 text-center text-xs text-[#827568]">No refunds.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[800px] w-full text-left">
            <thead className="border-b bg-[#F7F2EB]">
              <tr>
                {[
                  "Refund",
                  "Order",
                  "Amount",
                  "Reason",
                  "Status",
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
              {q.data.map((r: any) => (
                <tr key={r.id} className="text-xs">
                  <td className="px-3 py-3 font-mono">#{r.id}</td>
                  <td className="px-3 py-3">#{r.orderNumber ?? r.orderId}</td>
                  <td className="px-3 py-3 font-bold">
                    {inr(Number(r.amount))}
                  </td>
                  <td className="px-3 py-3 max-w-[240px] truncate">
                    {r.reason}
                  </td>
                  <td className="px-3 py-3">
                    <Badge
                      className={
                        r.status === "refunded"
                          ? "bg-[#E5F2E9] text-[#2F6947]"
                          : r.status === "requested"
                            ? "bg-[#FBF0D5] text-[#8A5D10]"
                            : "bg-[#F6F0E8]"
                      }
                    >
                      {r.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 flex gap-1">
                    {r.status === "requested" && (
                      <Button
                        className="h-7 text-xs bg-[#211B18] text-white"
                        onClick={() =>
                          update.mutate({
                            id: r.id,
                            status: "validated",
                            providerRefundId: null,
                          })
                        }
                        disabled={update.isPending}
                      >
                        Validate
                      </Button>
                    )}
                    {r.status === "validated" && (
                      <Button
                        className="h-7 text-xs bg-[#E2533C] text-white"
                        disabled={update.isPending}
                        onClick={() =>
                          update.mutate({
                            id: r.id,
                            status: "refunded",
                            providerRefundId: null,
                          })
                        }
                      >
                        Mark refunded
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#FCFAF6]">
          <DialogHeader>
            <DialogTitle>Request refund</DialogTitle>
            <DialogDescription>
              Idempotent: one requested per order.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="space-y-1">
              <span className="text-xs font-bold">Order ID</span>
              <Input
                value={form.orderId}
                onChange={e => setForm({ ...form, orderId: e.target.value })}
                placeholder="e.g. 42"
                className="bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Amount (₹)</span>
              <Input
                type="number"
                value={form.amount}
                onChange={e => setForm({ ...form, amount: e.target.value })}
                className="bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Reason</span>
              <Textarea
                value={form.reason}
                onChange={e => setForm({ ...form, reason: e.target.value })}
                className="bg-white"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (
                  !form.orderId ||
                  !form.amount ||
                  form.reason.trim().length < 3
                )
                  return toast.error("Fill fields");
                create.mutate({
                  orderId: Number(form.orderId),
                  amount: Number(form.amount),
                  reason: form.reason.trim(),
                });
              }}
              disabled={create.isPending}
              className="bg-[#211B18] text-white"
            >
              Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ExpensesTab({ outletId }: { outletId: number | null }) {
  const q = trpc.finance.expenses.list.useQuery(
    outletId ? { outletId } : undefined
  );
  const outlets = trpc.outlets.list.useQuery({ limit: 100 });
  const [open, setOpen] = useState(false);
  const form = useForm<z.infer<typeof expenseSchema>>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      outletId: outletId ? String(outletId) : "",
      category: "other",
      amount: "",
      vendor: "",
      date: new Date().toISOString().slice(0, 10),
      description: "",
    },
  });
  const create = trpc.finance.expenses.create.useMutation({
    onSuccess: () => {
      toast.success("Expense recorded — append-only");
      setOpen(false);
      form.reset();
      void q.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const onSubmit = form.handleSubmit(v =>
    create.mutate({
      outletId: v.outletId ? Number(v.outletId) : null,
      category: v.category,
      amount: Number(v.amount),
      vendor: v.vendor?.trim() || null,
      date: v.date,
      description: v.description?.trim() || null,
      attachmentUrl: null,
    })
  );
  return (
    <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold">Expenses — accounting-safe</h3>
        <Button
          onClick={() => {
            form.reset();
            setOpen(true);
          }}
          className="bg-[#211B18] text-xs text-white"
        >
          <Plus className="mr-1 h-3 w-3" />
          Add expense
        </Button>
      </div>
      {q.isLoading ? (
        <div className="grid place-items-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : q.isError ? (
        <p className="mt-4 text-center text-xs text-[#B83D29]">
          Expenses could not be loaded.{" "}
          <button className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : !q.data?.length ? (
        <p className="mt-4 text-center text-xs text-[#827568]">No expenses.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[760px] w-full text-left">
            <thead className="border-b bg-[#F7F2EB]">
              <tr>
                {[
                  "Date",
                  "Category",
                  "Outlet",
                  "Vendor",
                  "Amount",
                  "Description",
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
              {q.data.map((e: any) => (
                <tr key={e.id} className="text-xs">
                  <td className="px-3 py-3">
                    {new Date(e.date).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-3">
                    <Badge className="border-[#E3D9CE] bg-[#F6F0E8]">
                      {e.category}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    {e.outletName ?? e.outletId ?? "—"}
                  </td>
                  <td className="px-3 py-3">{e.vendor ?? "—"}</td>
                  <td className="px-3 py-3 font-bold">
                    {inr(Number(e.amount))}
                  </td>
                  <td className="px-3 py-3 max-w-[220px] truncate">
                    {e.description ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#FCFAF6]">
          <DialogHeader>
            <DialogTitle>Add expense</DialogTitle>
            <DialogDescription>
              Historical records are never silently overwritten.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="outletId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Outlet</FormLabel>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className="bg-white">
                          <SelectValue placeholder="Global" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="">Global</SelectItem>
                        {outlets.data?.items.map((o: any) => (
                          <SelectItem key={o.id} value={String(o.id)}>
                            {o.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="ingredients">Ingredients</SelectItem>
                        <SelectItem value="rent">Rent</SelectItem>
                        <SelectItem value="electricity">Electricity</SelectItem>
                        <SelectItem value="salaries">Salaries</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount (₹)</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} className="bg-white" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} className="bg-white" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="vendor"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Vendor</FormLabel>
                    <FormControl>
                      <Input {...field} className="bg-white" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea {...field} className="bg-white" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="sm:col-span-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={create.isPending}
                  className="bg-[#211B18] text-white"
                >
                  {create.isPending ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function TaxesTab() {
  const q = trpc.finance.taxes.list.useQuery();
  const outlets = trpc.outlets.list.useQuery({ limit: 100 });
  const [open, setOpen] = useState(false);
  const form = useForm<z.infer<typeof taxSchema>>({
    resolver: zodResolver(taxSchema),
    defaultValues: { name: "GST", type: "gst", rate: "5", outletId: "" },
  });
  const create = trpc.finance.taxes.create.useMutation({
    onSuccess: () => {
      toast.success("Tax saved — single calculation source");
      setOpen(false);
      form.reset();
      void q.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const onSubmit = form.handleSubmit(v =>
    create.mutate({
      name: v.name.trim(),
      type: v.type,
      rate: Number(v.rate),
      enabled: true,
      outletId: v.outletId ? Number(v.outletId) : null,
      applicability: null,
    })
  );
  return (
    <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold">Taxes — centralized</h3>
        <Button
          onClick={() => {
            form.reset();
            setOpen(true);
          }}
          className="bg-[#211B18] text-xs text-white"
        >
          <Plus className="mr-1 h-3 w-3" />
          Add tax
        </Button>
      </div>
      <p className="mt-1 text-xs text-[#776A5E]">
        Website, App, POS, Admin share the same pricing/tax logic. Do not
        duplicate calculation on the client.
      </p>
      {q.isLoading ? (
        <div className="grid place-items-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : q.isError ? (
        <p className="mt-4 text-center text-xs text-[#B83D29]">
          Taxes could not be loaded.{" "}
          <button className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : !q.data?.length ? (
        <p className="mt-4 text-center text-xs text-[#827568]">
          No taxes configured.
        </p>
      ) : (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {q.data.map((t: any) => (
            <div key={t.id} className="rounded-xl border bg-white p-4">
              <p className="text-sm font-bold">
                {t.name}{" "}
                <span className="ml-1 font-mono text-xs text-[#A83825]">
                  {t.rate}%
                </span>
              </p>
              <p className="text-xs text-[#776A5E]">
                {t.type} · {t.enabled ? "Enabled" : "Disabled"} ·{" "}
                {t.outletName ?? "Global"}
              </p>
            </div>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#FCFAF6]">
          <DialogHeader>
            <DialogTitle>New tax</DialogTitle>
            <DialogDescription>
              Centralized rate used by every sales channel.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={onSubmit} className="grid gap-3">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} className="bg-white" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="gst">GST</SelectItem>
                        <SelectItem value="service_charge">
                          Service charge
                        </SelectItem>
                        <SelectItem value="packaging_charge">
                          Packaging
                        </SelectItem>
                        <SelectItem value="delivery_charge">
                          Delivery
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="rate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rate %</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} className="bg-white" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="outletId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Outlet (optional)</FormLabel>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className="bg-white">
                          <SelectValue placeholder="Global" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="">Global</SelectItem>
                        {outlets.data?.items.map((o: any) => (
                          <SelectItem key={o.id} value={String(o.id)}>
                            {o.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={create.isPending}
                  className="bg-[#211B18] text-white"
                >
                  {create.isPending ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

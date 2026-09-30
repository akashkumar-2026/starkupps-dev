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
import { trpc } from "@/api/trpc";
import { useOutlet } from "@/state/outlet-provider";
import { Loader2, Plus, Search } from "lucide-react";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function SupportHub({ detailId }: { detailId?: number }) {
  const [, setLocation] = useLocation();
  if (detailId)
    return (
      <TicketDetail id={detailId} onBack={() => setLocation("/support")} />
    );
  return <TicketList />;
}

function TicketList() {
  const { selectedId } = useOutlet();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [cursor, setCursor] = useState<number | undefined>();
  const [history, setHistory] = useState<Array<number | undefined>>([]);
  useEffect(() => {
    setCursor(undefined);
    setHistory([]);
  }, [search, status, selectedId]);
  const q = trpc.support.list.useQuery({
    search: search.trim() || undefined,
    status: (status as any) || undefined,
    outletId: selectedId ?? undefined,
    limit: 25,
    cursor,
  });
  const outlets = trpc.outlets.list.useQuery({ limit: 100 });
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    outletId: selectedId ? String(selectedId) : "",
    subject: "",
    category: "general" as any,
    priority: "normal" as any,
    message: "",
  });
  const create = trpc.support.create.useMutation({
    onSuccess: () => {
      toast.success("Ticket created");
      setOpen(false);
      void q.refetch();
      void utils.support.list.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <>
      <section className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#A83825]">
            <span className="h-px w-7 bg-[#E2533C]" />
            Support
          </p>
          <h2 className="text-3xl font-extrabold tracking-[-0.055em]">
            Every ticket, owned.
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#75695E]">
            Customer, order, payment, outlet context — conversation, internal
            notes, and timeline are recorded.
          </p>
        </div>
        <Button
          onClick={() => setOpen(true)}
          className="bg-[#211B18] text-xs text-white"
        >
          <Plus className="mr-1 h-3 w-3" />
          New ticket
        </Button>
      </section>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#8E8174]" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search ticket, subject"
            className="h-10 border-[#DCCFC2] bg-[#FCFAF6] pl-9 text-xs"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-[180px] border-[#DCCFC2] bg-white text-xs">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In progress</SelectItem>
            <SelectItem value="waiting">Waiting</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
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
          <p className="text-sm font-bold">No tickets yet</p>
          <p className="text-xs text-[#827568]">
            Support workspace is empty — create a ticket with
            customer/order/outlet linkage.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6]">
          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-[860px] w-full text-left">
              <thead className="border-b bg-[#F7F2EB]">
                <tr>
                  {[
                    "Ticket",
                    "Subject",
                    "Customer",
                    "Outlet",
                    "Priority",
                    "Status",
                    "",
                  ].map(h => (
                    <th
                      key={h}
                      className="px-4 py-3 font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {q.data.items.map((t: any) => (
                  <tr key={t.id} className="hover:bg-white text-xs">
                    <td className="px-4 py-3 font-mono font-bold">
                      {t.ticketNumber}
                    </td>
                    <td className="px-4 py-3 font-bold">
                      {t.subject}
                      <p className="text-[11px] font-normal text-[#87796C]">
                        {t.category}
                      </p>
                    </td>
                    <td className="px-4 py-3">{t.customerName ?? "—"}</td>
                    <td className="px-4 py-3">
                      {t.outletName ?? (t.outletId ? `#${t.outletId}` : "—")}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        className={
                          t.priority === "urgent"
                            ? "bg-[#FBE4DD] text-[#A83825] border-[#F3C5B9]"
                            : t.priority === "high"
                              ? "bg-[#FBF0D5] text-[#8A5D10]"
                              : "bg-[#F6F0E8]"
                        }
                      >
                        {t.priority}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        className={
                          t.status === "open"
                            ? "bg-[#FBF0D5]"
                            : t.status === "resolved"
                              ? "bg-[#E5F2E9] text-[#2F6947]"
                              : "bg-[#F6F0E8]"
                        }
                      >
                        {t.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <a href={`/support/${t.id}`}>
                        <Button variant="outline" className="h-7 text-xs">
                          Open
                        </Button>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-2 p-3 md:hidden">
            {q.data.items.map((t: any) => (
              <div key={t.id} className="rounded-xl border bg-white p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold">
                    {t.ticketNumber}
                  </span>
                  <Badge className="text-[10px]">{t.status}</Badge>
                </div>
                <p className="mt-1 text-sm font-bold">{t.subject}</p>
                <p className="text-xs text-[#87796C]">
                  {t.customerName ?? "—"} · {t.outletName ?? "—"}
                </p>
                <a href={`/support/${t.id}`}>
                  <Button variant="outline" className="mt-3 h-7 w-full text-xs">
                    Open ticket
                  </Button>
                </a>
              </div>
            ))}
          </div>
        </div>
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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#FCFAF6]">
          <DialogHeader>
            <DialogTitle>New ticket</DialogTitle>
            <DialogDescription>
              Ticket number is auto-generated.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="space-y-1">
              <span className="text-xs font-bold">Outlet</span>
              <Select
                value={form.outletId}
                onValueChange={v => setForm({ ...form, outletId: v })}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {outlets.data?.items.map((o: any) => (
                    <SelectItem key={o.id} value={String(o.id)}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Subject</span>
              <Input
                value={form.subject}
                onChange={e => setForm({ ...form, subject: e.target.value })}
                className="bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Category</span>
              <Select
                value={form.category}
                onValueChange={v => setForm({ ...form, category: v as any })}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="order_issue">Order issue</SelectItem>
                  <SelectItem value="refund_request">Refund request</SelectItem>
                  <SelectItem value="complaint">Complaint</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Priority</span>
              <Select
                value={form.priority}
                onValueChange={v => setForm({ ...form, priority: v as any })}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Message</span>
              <Textarea
                value={form.message}
                onChange={e => setForm({ ...form, message: e.target.value })}
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
                  form.subject.trim().length < 5 ||
                  form.message.trim().length < 5
                )
                  return toast.error("Subject & message required");
                create.mutate({
                  customerId: null,
                  orderId: null,
                  outletId: form.outletId ? Number(form.outletId) : null,
                  category: form.category,
                  priority: form.priority,
                  subject: form.subject.trim(),
                  message: form.message.trim(),
                });
              }}
              className="bg-[#211B18] text-white"
              disabled={create.isPending}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TicketDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const q = trpc.support.byId.useQuery({ id });
  const [msg, setMsg] = useState("");
  const [internal, setInternal] = useState(false);
  const [status, setStatus] = useState("");
  const utils = trpc.useUtils();
  const add = trpc.support.addMessage.useMutation({
    onSuccess: () => {
      toast.success("Message added");
      setMsg("");
      void q.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const update = trpc.support.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("Ticket updated");
      void q.refetch();
      void utils.support.list.invalidate();
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
        Ticket not found{" "}
        <Button variant="outline" onClick={onBack} className="ml-2 h-7 text-xs">
          Back
        </Button>
      </div>
    );
  const { ticket, messages, timeline } = q.data as any;
  return (
    <>
      <Button variant="ghost" onClick={onBack} className="mb-4 px-0 text-xs">
        ← Support
      </Button>
      <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#A83825]">
              {ticket.ticketNumber} · {ticket.category}
            </p>
            <h2 className="text-xl font-extrabold">{ticket.subject}</h2>
            <p className="text-xs text-[#776A5E]">
              {ticket.customerName ?? "No customer"} · Order{" "}
              {ticket.orderNumber ?? "—"} · {ticket.outletName ?? "No outlet"}
            </p>
          </div>
          <div className="flex gap-2">
            <Badge
              className={
                ticket.priority === "urgent"
                  ? "bg-[#FBE4DD] text-[#A83825]"
                  : "bg-[#F6F0E8]"
              }
            >
              {ticket.priority}
            </Badge>
            <Badge
              className={
                ticket.status === "open"
                  ? "bg-[#FBF0D5]"
                  : "bg-[#E5F2E9] text-[#2F6947]"
              }
            >
              {ticket.status}
            </Badge>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-[180px] bg-white text-xs">
              <SelectValue placeholder="Set status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="waiting">Waiting</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          <Button
            className="h-8 bg-[#211B18] text-white text-xs"
            disabled={!status}
            onClick={() => update.mutate({ id, status: status as any })}
          >
            Update status
          </Button>
        </div>
      </section>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_300px]">
        <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
          <h3 className="text-sm font-extrabold">Conversation</h3>
          <div className="mt-3 space-y-3 max-h-[420px] overflow-auto pr-1">
            {!messages.length ? (
              <p className="text-xs text-[#827568]">No messages.</p>
            ) : (
              messages.map((m: any) => (
                <div
                  key={m.id}
                  className={`rounded-xl border p-3 ${m.internal ? "bg-[#FFF7ED] border-[#F0D5B2]" : "bg-white border-[#E4DCD1]"}`}
                >
                  <p className="text-xs font-bold">
                    {m.authorType} {m.internal ? "(internal)" : ""}
                  </p>
                  <p className="text-xs leading-5 text-[#5A4E45]">
                    {m.message}
                  </p>
                  <p className="text-[11px] text-[#87796C]">
                    {new Date(m.createdAt).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>
          <div className="mt-4 space-y-2">
            <Textarea
              value={msg}
              onChange={e => setMsg(e.target.value)}
              placeholder={
                internal
                  ? "Internal note (not visible to customer)"
                  : "Reply to customer"
              }
              className="bg-white text-xs"
            />
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={internal}
                onChange={e => setInternal(e.target.checked)}
              />{" "}
              Internal note
            </label>
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  if (!msg.trim()) return toast.error("Enter message");
                  add.mutate({ ticketId: id, message: msg.trim(), internal });
                }}
                disabled={add.isPending}
                className="bg-[#211B18] text-white text-xs"
              >
                {add.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Send"
                )}
              </Button>
            </div>
          </div>
        </section>
        <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
          <h3 className="text-sm font-extrabold">Activity timeline</h3>
          <div className="mt-3 space-y-2">
            {timeline.map((t: any, i: number) => (
              <div key={i} className="flex gap-2 text-xs">
                <span className="text-[#87796C]">
                  {new Date(t.at).toLocaleString()}
                </span>
                <span className="font-bold">{t.action}</span>
                <span className="truncate text-[#6F6257]">{t.detail}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

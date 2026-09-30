import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/api/trpc";
import { useOutlet } from "@/state/outlet-provider";
import { Loader2 } from "lucide-react";
import { useState, useEffect } from "react";

export default function AuditHub() {
  const { selectedId } = useOutlet();
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [cursor, setCursor] = useState<number | undefined>();
  const [history, setHistory] = useState<Array<number | undefined>>([]);
  useEffect(() => {
    setCursor(undefined);
    setHistory([]);
  }, [entityType, action, selectedId]);
  const q = trpc.audit.list.useQuery({
    outletId: selectedId ?? undefined,
    entityType: entityType || undefined,
    action: action || undefined,
    limit: 50,
    cursor,
  });
  return (
    <>
      <section className="mb-6">
        <p className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#A83825]">
          <span className="h-px w-7 bg-[#E2533C]" />
          Audit logs
        </p>
        <h2 className="text-3xl font-extrabold tracking-[-0.055em]">
          Who changed what, when — append-only.
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#75695E]">
          Product price, order cancellation, refund, staff role, outlet disable,
          inventory adjustment, coupon, settings, logins — actor, role, outlet,
          before/after.
        </p>
      </section>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger className="h-9 w-[180px] border-[#DCCFC2] bg-white text-xs">
              <SelectValue placeholder="All entities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All entities</SelectItem>
              <SelectItem value="order">Order</SelectItem>
              <SelectItem value="outlet">Outlet</SelectItem>
              <SelectItem value="rider">Rider</SelectItem>
              <SelectItem value="inventory_item">Inventory</SelectItem>
              <SelectItem value="coupon">Coupon</SelectItem>
              <SelectItem value="expense">Expense</SelectItem>
              <SelectItem value="support_ticket">Support</SelectItem>
            </SelectContent>
          </Select>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="h-9 w-[160px] border-[#DCCFC2] bg-white text-xs">
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All actions</SelectItem>
              <SelectItem value="created">Created</SelectItem>
              <SelectItem value="updated">Updated</SelectItem>
              <SelectItem value="deleted">Deleted</SelectItem>
              <SelectItem value="status_updated">Status</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          className="h-8 text-xs border-[#DCCFC2] bg-white"
          onClick={() => q.refetch()}
        >
          Refresh
        </Button>
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
          <p className="text-sm font-bold">No audit events yet</p>
          <p className="text-xs text-[#827568]">
            Actions like price changes, cancellations, refunds, and staff
            updates will appear here. History is append-only — ordinary admins
            cannot edit it.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6]">
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-left">
              <thead className="border-b bg-[#F7F2EB]">
                <tr>
                  {[
                    "Time",
                    "Actor",
                    "Action",
                    "Entity",
                    "Outlet",
                    "Before → After",
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
                {q.data.items.map((e: any) => (
                  <tr key={e.id} className="text-xs">
                    <td className="px-3 py-3 text-[#6F6257] whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-3 font-bold">{e.actorName}</td>
                    <td className="px-3 py-3">
                      <Badge className="border-[#E3D9CE] bg-[#F6F0E8]">
                        {e.action}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 font-mono">
                      {e.entityType} #{e.entityId ?? "—"}
                    </td>
                    <td className="px-3 py-3">
                      {e.outletName ??
                        (e.outletId ? `#${e.outletId}` : "Global")}
                    </td>
                    <td className="px-3 py-3 max-w-[320px] truncate text-[11px] text-[#5A4E45]">
                      {JSON.stringify(e.before ?? {})} →{" "}
                      {JSON.stringify(e.after ?? {})}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
    </>
  );
}

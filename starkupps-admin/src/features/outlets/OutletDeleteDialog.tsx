import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { queryClient } from "@/app/query-client";
import { trpc } from "@/api/trpc";
import { apiError } from "@/utils/errors";
import { getQueryKey } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { AlertTriangle, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { AppRouter } from "../../../server/routers";

/**
 * Cache key prefix for `outlets.list`, deliberately without an `input`
 * segment so it prefix-matches **every** cached variant at once — the outlets
 * grid (searched/filtered/paginated) and `OutletProvider`'s sidebar selector,
 * which holds a 60s `staleTime` and would otherwise keep listing a deleted
 * outlet for a minute after the dialog closed.
 */
const OUTLET_LIST_KEY = getQueryKey(trpc.outlets.list);

/**
 * Derived from the router rather than hand-written, so a change to the impact
 * contract on the server breaks the build here instead of silently drifting.
 */
type Impact = inferRouterOutputs<AppRouter>["outlets"]["deleteImpact"];

export function OutletDeleteDialog({
  open,
  onOpenChange,
  outletId,
  outletName,
  outletCode,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outletId: number | null;
  outletName: string;
  outletCode: string;
  /** Runs after a successful delete — the caller navigates away. */
  onDeleted?: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");

  const impact = trpc.outlets.deleteImpact.useQuery(
    { id: outletId! },
    { enabled: open && outletId != null, retry: false, staleTime: 0 }
  );

  // Never leave a stale confirmation behind: reopening for a different outlet
  // with the previous code still typed is exactly the accident this guard
  // exists to prevent.
  useEffect(() => {
    if (!open) {
      setConfirm("");
      setReason("");
    }
  }, [open, outletId]);

  const remove = trpc.outlets.delete.useMutation({
    onMutate: async ({ id }) => {
      // Drop the card from every cached list variant immediately so the grid
      // and the outlet selector react to the click, not to the round trip.
      await queryClient.cancelQueries({ queryKey: OUTLET_LIST_KEY });
      const previous = queryClient.getQueriesData<{ items?: any[] }>({
        queryKey: OUTLET_LIST_KEY,
      });
      queryClient.setQueriesData<{ items?: any[] }>(
        { queryKey: OUTLET_LIST_KEY },
        old =>
          old && Array.isArray(old.items)
            ? { ...old, items: old.items.filter(o => o?.id !== id) }
            : old
      );
      return { previous };
    },
    onError: (error, _vars, ctx) => {
      for (const [key, data] of ctx?.previous ?? []) {
        queryClient.setQueryData(key, data);
      }
      // A CONFLICT means work started after the dialog opened — re-open the
      // dialog so the operator sees the fresh blocker list rather than a toast
      // describing state they never read.
      const code = (error as { data?: { code?: string } } | null)?.data?.code;
      if (code === "CONFLICT") void impact.refetch();
      toast.error(apiError(error));
    },
    onSuccess: result => {
      const kept = result.detached.reduce((sum, r) => sum + r.count, 0);
      toast.success(`${result.code} deleted`, {
        description: kept
          ? `${result.totalPurged} dependent rows removed. ${kept} financial ${
              kept === 1 ? "record" : "records"
            } kept and unassigned.`
          : `${result.totalPurged} dependent rows removed.`,
      });
      onOpenChange(false);
      onDeleted?.();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: OUTLET_LIST_KEY });
    },
  });

  const data: Impact | undefined = impact.data;
  // Fail closed: with no target the preflight never runs, so treat the state
  // as not-deletable rather than showing a spinner that can never resolve.
  const noTarget = outletId == null;
  const blocked = noTarget || (!impact.isPending && impact.isError);
  const blockers = data?.blockers ?? [];
  const notDeletable = blocked || (data ? !data.deletable : false);
  const typedOk =
    confirm.trim().length > 0 &&
    confirm.trim().toUpperCase() === outletCode.trim().toUpperCase();
  const canSubmit = !notDeletable && typedOk && !remove.isPending;

  const submit = () => {
    if (!canSubmit || !outletId) return;
    remove.mutate({
      id: outletId,
      confirmCode: confirm.trim(),
      reason: reason.trim() || undefined,
    });
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        // Radix closes on Escape/overlay click; let it, the mutation keeps
        // running and `onSettled` invalidates regardless.
        if (remove.isPending) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-[#B83D29]" />
            Delete {outletName}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This removes the outlet and every record scoped to it. The outlet
            code{" "}
            <span className="font-mono font-bold text-[#A83825]">
              {outletCode}
            </span>{" "}
            becomes available again. Only owners can do this.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {impact.isPending && !noTarget && (
          <div className="flex items-center gap-2 rounded-lg border border-[#E4DCD1] bg-[#FCFAF6] px-3 py-6 text-xs text-[#77695E]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking what this delete would affect…
          </div>
        )}

        {blocked && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-[#E7B7AC] bg-[#FBEBE7] px-3 py-2 text-xs text-[#8E2A19]"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {noTarget
                ? "No outlet selected. Close this dialog and try again."
                : `Could not load the delete impact. ${apiError(impact.error)} `}
              {impact.error && (
                <button
                  type="button"
                  onClick={() => void impact.refetch()}
                  className="font-bold underline underline-offset-2"
                >
                  Retry
                </button>
              )}
            </span>
          </p>
        )}

        {data && blockers.length > 0 && (
          <ul
            role="alert"
            className="space-y-1.5 rounded-lg border border-[#E7B7AC] bg-[#FBEBE7] px-3 py-2.5 text-xs text-[#8E2A19]"
          >
            {blockers.map(message => (
              <li key={message} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{message}</span>
              </li>
            ))}
            <li className="pt-0.5 text-[#8E2A19]/80">
              Cancel the work, or mark the outlet inactive to take it off the
              storefront without losing its history.
            </li>
          </ul>
        )}

        {data && !data.deletable && (
          <p className="text-xs text-[#77695E]">
            To close an outlet without destroying anything, set its status to{" "}
            <span className="font-bold">Inactive</span> instead.
          </p>
        )}

        {data && (
          <div className="space-y-3 text-xs">
            {(data.purged.length > 0 || data.unassignedStaff.count > 0) && (
              <div className="rounded-lg border border-[#E4DCD1] bg-white">
                <p className="border-b border-[#EDE5DA] px-3 py-2 font-bold text-[#8E2A19]">
                  {data.totalPurged > 0
                    ? `Permanently deleted (${data.totalPurged} rows)`
                    : "Also cleared"}
                </p>
                <ul className="divide-y divide-[#F0EAE1]">
                  {data.purged.map(row => (
                    <li
                      key={row.table}
                      className="flex items-center justify-between px-3 py-1.5"
                    >
                      <span className="text-[#4A403A]">{row.label}</span>
                      <span className="font-mono font-bold">{row.count}</span>
                    </li>
                  ))}
                  {data.unassignedStaff.count > 0 && (
                    <li className="flex items-center justify-between px-3 py-1.5">
                      <span className="text-[#4A403A]">
                        {data.unassignedStaff.label}
                      </span>
                      <span className="font-mono font-bold">
                        {data.unassignedStaff.count}
                      </span>
                    </li>
                  )}
                </ul>
              </div>
            )}

            {data.detached.length > 0 && (
              <div className="rounded-lg border border-[#CFE0D5] bg-[#F4F9F6]">
                <p className="border-b border-[#DCEBE2] px-3 py-2 font-bold text-[#2F6947]">
                  Kept as financial records
                </p>
                <ul className="divide-y divide-[#E6F0EA]">
                  {data.detached.map(row => (
                    <li
                      key={row.table}
                      className="flex items-center justify-between px-3 py-1.5"
                    >
                      <span className="text-[#33553F]">
                        {row.label} — no longer linked to an outlet
                      </span>
                      <span className="font-mono font-bold text-[#2F6947]">
                        {row.count}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.purged.length === 0 &&
              data.detached.length === 0 &&
              data.unassignedStaff.count === 0 && (
                <p className="text-[#77695E]">
                  Nothing else is attached to this outlet yet.
                </p>
              )}
          </div>
        )}

        {!notDeletable && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="outlet-delete-confirm" className="text-xs">
                Type{" "}
                <span className="font-mono font-bold text-[#A83825]">
                  {outletCode}
                </span>{" "}
                to confirm
              </Label>
              <Input
                id="outlet-delete-confirm"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && canSubmit) {
                    e.preventDefault();
                    submit();
                  }
                }}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-describedby="outlet-delete-confirm-help"
                placeholder={outletCode}
                className="h-9 border-[#DCCFC2] bg-white font-mono text-xs uppercase"
              />
              <p
                id="outlet-delete-confirm-help"
                className="text-[11px] text-[#87796C]"
              >
                The server re-checks this code and the blocker list, so a
                request that does not match is rejected.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="outlet-delete-reason" className="text-xs">
                Reason <span className="text-[#A29A92]">(optional)</span>
              </Label>
              <Input
                id="outlet-delete-reason"
                value={reason}
                maxLength={240}
                onChange={e => setReason(e.target.value)}
                placeholder="Closed permanently, merged into Jmp"
                className="h-9 border-[#DCCFC2] bg-[#FCFAF6] text-xs"
              />
            </div>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>
            {notDeletable ? "Close" : "Cancel"}
          </AlertDialogCancel>
          {!notDeletable && (
            <AlertDialogAction
              className="bg-[#B83D29] hover:bg-[#962C20]"
              disabled={!canSubmit}
              onClick={event => {
                // The dialog must stay mounted through the mutation so the
                // pending state and any failure stay visible; preventing the
                // default is what stops Radix from closing it.
                event.preventDefault();
                submit();
              }}
            >
              {remove.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Delete outlet
                </>
              )}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

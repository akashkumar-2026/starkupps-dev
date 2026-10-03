/**
 * Per-outlet control over which ordering methods customers can use.
 *
 * ## Why this is a dedicated panel
 *
 * The capability flags live in `outlets.services`, and they were previously only
 * reachable through `outlets.update` — a whole-outlet form requiring name, hours,
 * coordinates and all five flags at once. In practice that meant an admin who
 * wanted to switch delivery off at one outlet had to open and resubmit the
 * entire outlet record to do it, and anyone who had not filled that form in had
 * no way to disable anything at all. The storefront meanwhile hardcoded all three
 * methods, so a disabled flag could only ever be discovered by a customer hitting
 * a rejection at checkout.
 *
 * ## Save model
 *
 * Save-on-toggle against `outlets.updateServices`, which takes a *patch*. That
 * keeps each switch independent: flipping delivery cannot overwrite the dine-in
 * setting, and there is no shared form to lose unsaved edits from.
 *
 * ## What is displayed is what is stored
 *
 * The switches read from the last value the server confirmed, never from local
 * optimism. A failed save leaves the switch where it was and says so — a switch
 * showing "on" while the database says "off" is worse than no switch at all,
 * because the operator would reasonably believe delivery was still running.
 */
import {
  FULFILLMENT_SERVICE_COPY,
  OUTLET_ORDER_TYPE_KEYS,
  parseOutletServices,
  type OutletOrderTypeKey,
} from "@shared/outletServices";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/api/trpc";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { apiError } from "@/utils/errors";

export function OutletFulfillmentPanel({
  outletId,
  services,
  canEdit,
}: {
  outletId: number;
  /** Raw `outlets.services`, straight from the outlet record. */
  services: unknown;
  /** `outlets.update`, i.e. owner or manager. Disables the switches when false. */
  canEdit: boolean;
}) {
  // The single source of truth for what is on screen. Starts from the outlet row
  // and is only ever replaced by a value the server confirmed.
  const [saved, setSaved] = useState(() => parseOutletServices(services));
  // Keyed per-method so one in-flight save cannot disable an unrelated switch,
  // and so concurrent saves of *different* methods do not clobber each other.
  const [savingKey, setSavingKey] = useState<OutletOrderTypeKey | null>(null);

  // Adopt an externally-changed record. Needed because a save made elsewhere (a
  // second admin tab, the POS, `outlets.update`) arrives as a new prop, and the
  // panel must show the database's state rather than a stale local copy.
  // Serialised so a fresh-but-equal object does not retrigger on every render.
  const serialized = JSON.stringify(services);
  const [adopted, setAdopted] = useState(serialized);
  if (adopted !== serialized) {
    setAdopted(serialized);
    setSaved(parseOutletServices(services));
  }

  const utils = trpc.useUtils();
  const save = trpc.outlets.updateServices.useMutation({
    onSuccess: (result, variables) => {
      const key = Object.keys(variables.services)[0] as OutletOrderTypeKey;
      setSaved(result.services);
      const label = FULFILLMENT_SERVICE_COPY[key]?.title ?? "Setting";
      toast.success(
        `${label} ${result.services[key] ? "enabled" : "disabled"}`,
        {
          description:
            "Customers will see this change on the website immediately.",
        }
      );
      // Keep the outlet list, its header badges and this panel consistent.
      void utils.outlets.byId.invalidate({ id: outletId });
      void utils.outlets.list.invalidate();
    },
    onError: (error, variables) => {
      // Deliberately does not touch `saved`: the switch springs back to the
      // persisted state, so what is displayed always matches the database.
      const key = Object.keys(variables.services)[0] as OutletOrderTypeKey;
      const label = FULFILLMENT_SERVICE_COPY[key]?.title ?? "Setting";
      toast.error(`${label} was not saved`, {
        description: apiError(error),
      });
    },
    onSettled: () => setSavingKey(null),
  });

  const toggle = (key: OutletOrderTypeKey, next: boolean) => {
    if (!canEdit || savingKey) return;
    setSavingKey(key);
    save.mutate({ id: outletId, services: { [key]: next } });
  };

  const onlineOrdering = saved.onlineOrdering !== false;
  const enabledCount = OUTLET_ORDER_TYPE_KEYS.filter(
    key => saved[key] !== false
  ).length;
  const nothingEnabled = onlineOrdering && enabledCount === 0;

  return (
    <div className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold">Order types</h3>
          <p className="mt-1 max-w-xl text-xs text-[#776A5E]">
            Choose which ways customers can order from this outlet. Changes save
            immediately and take effect on the website straight away — a method
            you switch off can no longer be used, even from an already-open
            checkout. Existing orders are unaffected.
          </p>
        </div>
        <Badge
          className={
            onlineOrdering && enabledCount > 0
              ? "border-[#BDE0C8] bg-[#E5F2E9] text-[#2F6947]"
              : "border-[#F1C9BD] bg-[#FFF0EA] text-[#9A3627]"
          }
        >
          {enabledCount} of {OUTLET_ORDER_TYPE_KEYS.length} enabled
        </Badge>
      </div>

      {nothingEnabled ? (
        <div
          role="alert"
          className="mt-4 flex gap-2.5 rounded-xl border border-[#F1C9BD] bg-[#FFF0EA] p-3"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#B83D29]" />
          <div className="text-xs text-[#7A2E22]">
            <p className="font-bold">
              No order types are enabled — customers cannot order from this
              outlet.
            </p>
            <p className="mt-1">
              The website will show &ldquo;online ordering unavailable&rdquo;
              and checkout will be blocked. This is a supported state and
              existing orders still show normally; switch at least one method
              back on to resume taking orders.
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-4 divide-y divide-[#E7DED4]">
        {OUTLET_ORDER_TYPE_KEYS.map(key => {
          const copy = FULFILLMENT_SERVICE_COPY[key];
          const enabled = saved[key] !== false;
          const busy = savingKey === key;
          return (
            <div
              key={key}
              className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <Label
                  htmlFor={`fulfillment-${key}`}
                  className="text-sm font-bold text-[#211B18]"
                >
                  {copy.title}
                </Label>
                <p className="mt-0.5 text-xs leading-5 text-[#776A5E]">
                  {copy.description}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 pt-0.5">
                {busy ? (
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin text-[#8A7D70]"
                    aria-label="Saving"
                  />
                ) : null}
                <Switch
                  id={`fulfillment-${key}`}
                  checked={enabled}
                  // Disabled while any save is in flight, so two toggles cannot
                  // race and land out of order.
                  disabled={!canEdit || savingKey !== null}
                  onCheckedChange={next => toggle(key, next)}
                  aria-label={`${copy.title} ordering`}
                />
                <span className="w-9 text-right text-[11px] font-bold text-[#675F56]">
                  {enabled ? "ON" : "OFF"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Save-on-toggle leaves nothing pending, so there is nothing to lose by
          navigating away — which is why this panel needs no beforeunload guard
          or explicit Save button. */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#E7DED4] pt-4">
        <div className="flex items-center gap-2 text-xs text-[#776A5E]">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-[#E5F2E9] text-[#2F6947]">
            <Check className="h-3 w-3" />
          </span>
          {savingKey ? "Saving…" : "Saved automatically · no pending changes"}
        </div>
        <Button
          variant="outline"
          className="h-8 text-xs"
          disabled={savingKey !== null}
          onClick={() => void utils.outlets.byId.invalidate({ id: outletId })}
        >
          Refresh from database
        </Button>
      </div>

      {!canEdit ? (
        <p className="mt-3 text-[11px] text-[#87796C]">
          You need the <code>outlets.update</code> permission (owner or manager)
          to change these settings.
        </p>
      ) : null}
    </div>
  );
}

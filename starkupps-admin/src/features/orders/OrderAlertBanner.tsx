/**
 * The visible half of the order alert.
 *
 * A ringtone nobody can see the state of is a liability. Three things have to be
 * obvious at a glance, and only one of them is "it is ringing":
 *
 * * **Sound is blocked.** An order is waiting and the browser will not let us
 *   make noise. This is the dangerous state — the operator is about to miss an
 *   order — so it is styled as a hard warning with a button, not a passive badge.
 * * **Sound is muted by choice.** Quiet. They already know; nagging them the way
 *   the blocked state does would train them to ignore it.
 * * **Nothing is waiting.** The indicator goes quiet so that its presence means
 *   something.
 */
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import { useLocation } from "wouter";
import { Bell, BellOff, Volume2, VolumeX } from "lucide-react";

import { describePending } from "./order-alert";
import { useOrderAlert } from "@/state/order-alert-provider";

/**
 * Compact header control. Always mounted, so the sound toggle is discoverable
 * *before* it is needed — hunting for a mute button while an order rings is worse
 * than not having one.
 */
export function OrderAlertIndicator() {
  const alert = useOrderAlert();
  if (!alert) return null;
  const { tone, state, preference, setPreference, unlock } = alert;
  const silent = state.pendingCount > 0 && tone === "silent-waiting";
  const waiting = state.pendingCount > 0;
  const muted = preference === "off";

  return (
    <div className="flex items-center gap-1.5">
      {silent ? (
        <Button
          size="sm"
          onClick={unlock}
          className="h-8 gap-1.5 bg-[#B83D29] text-xs text-white hover:bg-[#962C20]"
          title="An order is waiting but the browser is blocking sound"
        >
          <VolumeX className="h-3.5 w-3.5" />
          Enable sound
        </Button>
      ) : (
        <button
          type="button"
          onClick={() => setPreference(muted ? "on" : "off")}
          aria-pressed={!muted}
          title={
            muted
              ? "Order sound is off — click to turn it on"
              : "Order sound is on — click to mute"
          }
          className={cn(
            "grid size-8 place-items-center rounded-full border transition-colors",
            waiting && !muted
              ? "border-[#E2533C] bg-[#FFF0EA] text-[#B83D29]"
              : "border-[#E4DCD1] bg-[#FCFAF6] text-[#8A7D70] hover:text-[#211B18]"
          )}
        >
          {muted ? (
            <BellOff className="h-3.5 w-3.5" />
          ) : waiting ? (
            <Bell className="h-3.5 w-3.5 animate-[pulse_1.2s_ease-in-out_infinite]" />
          ) : (
            <Volume2 className="h-3.5 w-3.5" />
          )}
          {waiting ? (
            <span className="sr-only">
              {describePending(state.pendingCount)}
            </span>
          ) : null}
        </button>
      )}
    </div>
  );
}

/**
 * A banner above the page body whenever orders are waiting.
 *
 * Its purpose is to make the wait visible even when the operator has muted the
 * sound, is looking at another view, or has scrolled past the queue. The
 * "silent-waiting" variant says why it cannot ring, because otherwise an
 * unexplained banner that no sound accompanies looks like a broken panel.
 */
export function OrderAlertBanner() {
  const alert = useOrderAlert();
  const [, setLocation] = useLocation();
  if (!alert) return null;
  const { tone, state, scopeLabel, newest, unlock } = alert;
  if (tone === "clear") return null;

  const blocked = tone === "silent-waiting";
  const muted = tone === "muted-waiting";
  const first = newest[0];

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3",
        blocked
          ? "border-[#E2533C] bg-[#FFF0EA] text-[#7A2E22]"
          : muted
            ? "border-[#E4DCD1] bg-[#F7F2EB] text-[#5A4E45]"
            : "border-[#BDE0C8] bg-[#E5F2E9] text-[#2F6947]"
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {blocked ? (
          <VolumeX className="h-4 w-4 shrink-0" />
        ) : muted ? (
          <BellOff className="h-4 w-4 shrink-0" />
        ) : (
          <Volume2 className="h-4 w-4 shrink-0" />
        )}
        <div className="min-w-0 text-xs">
          <p className="font-bold">
            {describePending(state.pendingCount)}
            {first ? ` · newest #${first.orderNumber}` : ""}
          </p>
          <p className="mt-0.5 opacity-80">
            {blocked
              ? "Your browser is blocking sound, so this alert is silent. Enable it to hear new orders."
              : muted
                ? "Order sound is muted, so you will not hear this."
                : `Ringing for ${scopeLabel}. Stop when every one is actioned.`}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {blocked ? (
          <Button
            size="sm"
            onClick={unlock}
            className="h-8 bg-[#B83D29] text-xs text-white hover:bg-[#962C20]"
          >
            Enable sound
          </Button>
        ) : null}
        {first ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setLocation(`/orders/${first.id}`)}
            className="h-8 border-current text-xs"
          >
            Open ticket
          </Button>
        ) : null}
      </div>
    </div>
  );
}

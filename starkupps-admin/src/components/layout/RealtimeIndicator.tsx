import { useRealtimeStatus } from "@/hooks/use-admin-stream";
import { cn } from "@/utils/cn";

const LABEL = {
  live: "Live",
  connecting: "Connecting",
  reconnecting: "Reconnecting",
  closed: "Offline",
} as const;

const TONE = {
  live: "bg-veg",
  connecting: "bg-amber-500",
  reconnecting: "bg-amber-500",
  closed: "bg-[#BAAFA1]",
} as const;

/**
 * Connection status for the gateway's realtime relay.
 *
 * The panel degrades to polling when the relay is unavailable, which used to be
 * invisible: nothing indicated that "live" updates were not arriving. This makes
 * the actual state explicit, and the title attribute names the topics so a
 * multi-panel user can see which streams are up.
 *
 * `role="status"` with `aria-live="polite"` announces changes without
 * interrupting whatever the user is doing.
 */
export function RealtimeIndicator({ className }: { className?: string }) {
  const { state, topics } = useRealtimeStatus();
  const label = LABEL[state];

  return (
    <span
      role="status"
      aria-live="polite"
      title={
        topics.length > 0
          ? `${label} — ${topics.length} stream${topics.length === 1 ? "" : "s"}: ${topics.join(", ")}`
          : `${label} — no realtime stream is open. Data refreshes on a timer.`
      }
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#E4DCD1] bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#776A5E]",
        className
      )}
    >
      <span className="relative grid size-2 place-items-center">
        {state === "live" && (
          <span className="absolute size-2 animate-ping rounded-full bg-veg/70" />
        )}
        <span className={cn("size-2 rounded-full", TONE[state])} />
      </span>
      {label}
    </span>
  );
}

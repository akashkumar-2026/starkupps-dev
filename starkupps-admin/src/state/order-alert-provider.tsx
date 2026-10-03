/**
 * New-order ringtone, mounted across the whole Admin panel.
 *
 * ## What it does
 *
 * Loops `public/order-ringtone.mp3` continuously while any order is still
 * untouched (`status = 'new'`), and stops the moment the last one has been
 * advanced or cancelled. It is mounted in `AdminWorkspace` rather than on the
 * Orders page so that the screen the operator happens to be on does not decide
 * whether they hear an order.
 *
 * ## The stop condition is state, not an event
 *
 * Ringing is derived from a count read from the server, not from "an order
 * arrived". A new order is one nobody has acted on, so "no `new` orders left"
 * and "every new order has been handled" are the same statement — and deriving it
 * from state means a dropped SSE frame, a sleeping laptop or a gateway restart
 * cannot leave the panel ringing about an order handled ten minutes ago.
 *
 * ## Why there is a small `pending` endpoint
 *
 * The count cannot come from `admin.orders.list`: that list is filtered by
 * whichever status tab is open and paginated at 24, so `items.length` is "how
 * many are on this page of this filter", not "how many are waiting".
 *
 * ## Scope, and the one filter deliberately ignored
 *
 * The header's **outlet** selector is honoured — it is the operator's declared
 * station, it is persisted, and the indicator names it. Ignoring it would ring
 * for outlets they are not working, and an alert that cries wolf gets muted,
 * which then silences their own outlet too.
 *
 * The **shift** selector is deliberately *not* honoured. It is a reporting
 * window over history, not an assignment: scoping an alert to it would mean an
 * order could arrive and be inaudible because of a dropdown left on last
 * night's shift. For a safety-critical alert, the direction that fails safely is
 * "may ring too much", never "may go silent".
 *
 * ## Browser autoplay
 *
 * Browsers refuse `play()` without a user gesture. Signing in requires a click,
 * so in practice the first order does ring. When it does not — a restored
 * session, a stricter browser — the failure is detected specifically and the
 * header shows a loud "sound blocked" state with a button, rather than the panel
 * silently sitting on an order. See `order-alert.ts` for the decision logic.
 */
import { trpc } from "@/api/trpc";
import {
  useAdminStream,
  useAdaptiveRefetchInterval,
} from "@/hooks/use-admin-stream";
import { useOutlet } from "@/state/outlet-provider";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import {
  alertTone,
  initialRingState,
  isAutoplayRejection,
  readPreference,
  ringReducer,
  RINGTONE_SRC,
  shouldRing,
  SOUND_STORAGE_KEY,
  type AlertTone,
  type RingState,
  type SoundPreference,
} from "@/features/orders/order-alert";

type OrderAlertCtx = {
  state: RingState;
  tone: AlertTone;
  preference: SoundPreference;
  setPreference: (next: SoundPreference) => void;
  /** Retries playback from a click, for the "enable sound" button. */
  unlock: () => void;
  /** The outlet label the alert is currently scoped to, for the indicator. */
  scopeLabel: string;
  /** Newest waiting ticket, for a one-click jump from the banner. */
  newest: Array<{ id: number; orderNumber: number }>;
};

const OrderAlertContext = createContext<OrderAlertCtx | null>(null);

/**
 * Reads the stored preference once, before the first render.
 *
 * `localStorage` access is guarded because Safari throws on it in private mode
 * and inside some sandboxed iframes; an unreadable store must not take the panel
 * down.
 */
function initialPreference(): SoundPreference {
  try {
    return readPreference(window.localStorage.getItem(SOUND_STORAGE_KEY));
  } catch {
    return "on";
  }
}

export function OrderAlertProvider({ children }: { children: ReactNode }) {
  const { selectedId, label: scopeLabel } = useOutlet();
  const utils = trpc.useUtils();

  const [state, dispatch] = useReducer(ringReducer, undefined, () =>
    initialRingState(initialPreference())
  );

  /**
   * Count refetch: fast while the relay is down, slow safety net while it is
   * live — same policy the order list uses, so a dead stream cannot leave the
   * panel waiting 15 seconds to notice an order it missed.
   */
  const pollMs = useAdaptiveRefetchInterval(120_000, 15_000);
  const pending = trpc.admin.orders.pending.useQuery(
    { outletId: selectedId ?? undefined },
    { refetchInterval: pollMs }
  );

  // Every stream event, plus every (re)subscribe, refreshes the count. The
  // reconnect matters most: an order inserted while the socket was down is
  // otherwise invisible, and the alert would never sound for it.
  const sync = useCallback(() => {
    void utils.admin.orders.pending.invalidate();
  }, [utils]);
  useAdminStream({
    enabled: true,
    topic: "orders",
    outletId: selectedId ?? "all",
    onEvent: sync,
    onSync: sync,
  });

  const count = pending.data?.count;
  useEffect(() => {
    // Guarded on a defined count so a failed read leaves the last known state
    // alone instead of clearing the alert for a waiting order.
    if (typeof count === "number") dispatch({ type: "pending", count });
  }, [count]);

  /**
   * Clear the count when the outlet scope changes.
   *
   * `pending` has no `placeholderData`, so the new query starts with `data`
   * undefined while loading — and the guard above then leaves the *previous*
   * outlet's count in place. That is the wrong direction twice over: the panel
   * rings for a station the operator just navigated away from, and if the new
   * outlet's query then fails, it would ring indefinitely for an order that is
   * not theirs. Resetting to zero fails safe — a brief gap where a genuine order
   * is not yet counted, rather than a permanent ring for someone else's.
   */
  useEffect(() => {
    dispatch({ type: "pending", count: 0 });
  }, [selectedId]);

  // ── The audio element ────────────────────────────────────────────────────
  // One persistent element for the lifetime of the panel. Recreating it per
  // alert would restart the clip mid-loop and re-trigger the autoplay decision.
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const attemptPlay = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    try {
      await el.play();
      dispatch({ type: "blocked", blocked: false });
    } catch (error) {
      if (isAutoplayRejection(error)) {
        dispatch({ type: "blocked", blocked: true });
        return;
      }
      // A decode/404 failure will fail identically forever. Logged once rather
      // than surfaced as "click to enable", which could never work.
      console.error("[order-alert] ringtone playback failed", error);
    }
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.loop = true;
    const onReady = () => dispatch({ type: "playable", playable: true });
    el.addEventListener("canplay", onReady);
    return () => {
      el.removeEventListener("canplay", onReady);
      el.pause();
    };
  }, []);

  // Drive playback from state. `el.paused` guards against restarting the clip on
  // every render, which would make it sound like a stutter rather than a loop.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (shouldRing(state)) {
      if (el.paused) {
        el.currentTime = 0;
        void attemptPlay();
      }
      return;
    }
    if (!el.paused) el.pause();
  }, [state, attemptPlay]);

  /**
   * One-shot retry after a real gesture.
   *
   * The listener is armed only while blocked and while the retry budget is
   * unspent, so a panel that cannot unlock does not accumulate listeners or
   * hijack unrelated clicks.
   */
  useEffect(() => {
    if (!state.blocked || state.retriedAfterGesture) return;
    const unlock = () => {
      dispatch({ type: "gesture" });
      void attemptPlay();
    };
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, [state.blocked, state.retriedAfterGesture, attemptPlay]);

  const setPreference = useCallback((next: SoundPreference) => {
    dispatch({ type: "preference", preference: next });
    try {
      window.localStorage.setItem(SOUND_STORAGE_KEY, next);
    } catch {}
  }, []);

  const unlock = useCallback(() => {
    // An explicit click is the gesture the policy wants; spend the retry budget
    // so the document-level listener does not also fire for this same click.
    dispatch({ type: "gesture" });
    void attemptPlay();
  }, [attemptPlay]);

  const value = useMemo<OrderAlertCtx>(
    () => ({
      state,
      tone: alertTone(state),
      preference: state.preference,
      setPreference,
      unlock,
      scopeLabel,
      newest: pending.data?.newest ?? [],
    }),
    [state, setPreference, unlock, scopeLabel, pending.data?.newest]
  );

  return (
    <OrderAlertContext.Provider value={value}>
      {/*
        `preload="auto"` warms the ~450 KB clip once per browser session so the
        first order is not clipped by a download mid-ring. `hidden` keeps it out
        of the layout; a display:none audio element still plays.

        The path comes from `RINGTONE_SRC` rather than being repeated here, so
        the constant, the test and the element cannot drift apart. Vite serves
        `public/` at the root in dev and copies it into `dist/public` for the
        build that the Express server hosts.
      */}
      <audio ref={audioRef} src={RINGTONE_SRC} preload="auto" hidden />
      {children}
    </OrderAlertContext.Provider>
  );
}

/**
 * Reads the alert state. Returns `null` outside the provider so a component
 * rendered outside the workspace can degrade instead of throwing.
 */
export function useOrderAlert(): OrderAlertCtx | null {
  return useContext(OrderAlertContext);
}

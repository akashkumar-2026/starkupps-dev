/**
 * Pure decision logic for the new-order ringtone.
 *
 * ## Why this is separated from the effect
 *
 * The awkward part of an order alert is not the `<audio>` element, it is the
 * state machine around it: how many orders are waiting, whether the operator
 * has sound switched on, whether the browser has actually let us make noise, and
 * what happens when an order arrives while we are still blocked. Getting that
 * wrong produces the two failures that matter operationally — a panel that stays
 * silent while an order waits, or one that rings forever after the order is
 * handled.
 *
 * The DOM wiring cannot be unit-tested in this repo (`vitest.config.ts` runs
 * `environment: "node"`, with no jsdom and no React testing library), so the
 * decisions live here where they can be.
 *
 * ## The stop condition
 *
 * Ringing is a *function of state*, not of events: it plays while
 * `status = 'new'` orders exist and stops when none remain. A new order is, by
 * definition, one nobody has acted on, so "no new orders left" and "the admin
 * has acted on every new order" are the same statement.
 *
 * Deriving it from state rather than from the arrival event also means the alert
 * self-heals. A dropped SSE frame, a laptop that slept, or a gateway restart
 * cannot leave the panel ringing about an order that was handled ten minutes ago
 * — the next count simply reads zero and the sound stops.
 */

export type SoundPreference = "on" | "off";

export const SOUND_STORAGE_KEY = "starkupps_order_sound";

/** Where the clip is served from. Vite copies `public/` to the build root. */
export const RINGTONE_SRC = "/order-ringtone.mp3";

/**
 * Reads the stored preference.
 *
 * Defaults to **on**, and that default is what makes the feature useful. The
 * first `play()` after login almost always succeeds anyway, because signing in
 * required a click and browsers grant autoplay once the page has seen any user
 * gesture ("sticky activation"). Defaulting to `off` would mean a silent panel
 * until someone went looking for a toggle — the exact failure this is meant to
 * prevent.
 *
 * Anything unrecognised — a corrupt value, a value from an older build — reads
 * as `on` for the same reason. The gate that matters is the operator's explicit
 * choice to mute.
 */
export function readPreference(raw: unknown): SoundPreference {
  return raw === "off" ? "off" : "on";
}

/**
 * Distinguishes "the browser blocked us" from "the audio is broken".
 *
 * These need opposite responses. A blocked `play()` is recoverable: the next
 * click anywhere unlocks it, so we arm a one-shot retry and tell the operator
 * why there is silence. Any other rejection — a 404, a decode failure, an
 * unsupported codec — will fail identically on retry, so showing "click to
 * enable sound" would send someone to click at a button that can never work.
 *
 * `NotAllowedError` is the autoplay-policy rejection in every current browser.
 * The name check is on the constructor *and* `name` because engines disagree on
 * which is populated across realms (an `AudioError` crossing an iframe boundary
 * keeps its prototype but may report an empty `name`).
 */
export function isAutoplayRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: unknown;
    constructor?: { name?: unknown };
  };
  return (
    candidate.name === "NotAllowedError" ||
    candidate.constructor?.name === "NotAllowedError"
  );
}

export type RingState = {
  /** Orders still waiting for a human, as last observed. */
  pendingCount: number;
  preference: SoundPreference;
  /** The audio element can start playing. */
  playable: boolean;
  /** The browser refused to play without a user gesture. */
  blocked: boolean;
  /**
   * A blocked play has already been retried after a gesture.
   *
   * Without this the retry would re-arm itself forever: every click that failed
   * to unlock would queue another one, and the panel would keep trying on a
   * click the operator believed was something else.
   */
  retriedAfterGesture: boolean;
};

export type RingAction =
  | { type: "pending"; count: number }
  | { type: "preference"; preference: SoundPreference }
  | { type: "playable"; playable: boolean }
  | { type: "blocked"; blocked: boolean }
  | { type: "gesture" };

export function initialRingState(preference: SoundPreference): RingState {
  return {
    pendingCount: 0,
    preference,
    playable: false,
    blocked: false,
    retriedAfterGesture: false,
  };
}

export function ringReducer(state: RingState, action: RingAction): RingState {
  switch (action.type) {
    case "pending":
      // A negative or non-integer count can only come from a bad response;
      // treating it as "nothing waiting" would silence a real order.
      return Number.isInteger(action.count) && action.count > 0
        ? { ...state, pendingCount: action.count }
        : { ...state, pendingCount: 0 };

    case "preference":
      return {
        ...state,
        preference: action.preference,
        // Un-muting is exactly when a retry is worth another attempt: the
        // operator is telling us they want sound.
        retriedAfterGesture:
          action.preference === "on" ? false : state.retriedAfterGesture,
      };

    case "playable":
      return { ...state, playable: action.playable };

    case "blocked":
      return {
        ...state,
        blocked: action.blocked,
        retriedAfterGesture: action.blocked ? true : state.retriedAfterGesture,
      };

    case "gesture":
      // Only a genuine gesture on an unblocked-by-arming play consumes the
      // single retry. Once spent, further clicks are ignored.
      if (!state.blocked || state.retriedAfterGesture) return state;
      return { ...state, retriedAfterGesture: true };

    default:
      return state;
  }
}

/**
 * Whether the audio element should currently be running.
 *
 * Requires all four of: sound switched on, something waiting, the file loaded,
 * and not known-blocked. `blocked` is checked because retrying a play the
 * browser has already refused just produces another rejected promise on every
 * render.
 */
export function shouldRing(state: RingState): boolean {
  return (
    state.preference === "on" &&
    state.pendingCount > 0 &&
    state.playable &&
    !state.blocked
  );
}

/** True when the panel is silent *despite* orders waiting — the broken case. */
export function needsAttention(state: RingState): boolean {
  return state.preference === "on" && state.pendingCount > 0 && state.blocked;
}

export type AlertTone =
  "ringing" | "silent-waiting" | "muted-waiting" | "clear";

/**
 * What the indicator should say and how loudly.
 *
 * The four states are genuinely different from the operator's point of view and
 * collapsing them is how an alert becomes ignored:
 *
 * * `ringing` — working; just reassurance.
 * * `silent-waiting` — an order is waiting and *cannot* alert. This is the one
 *   that must be visually loud, because the operator is about to miss an order.
 * * `muted-waiting` — the operator chose silence. Quiet reminder only; they
 *   already know.
 * * `clear` — nothing waiting.
 */
export function alertTone(state: RingState): AlertTone {
  if (state.pendingCount === 0) return "clear";
  if (state.preference === "off") return "muted-waiting";
  if (needsAttention(state)) return "silent-waiting";
  return "ringing";
}

export function describePending(count: number): string {
  if (count <= 0) return "No new orders";
  if (count === 1) return "1 new order waiting";
  return `${count} new orders waiting`;
}

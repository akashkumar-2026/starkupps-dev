import type { AuthUser, StaffRole } from "@/types";
import { AUTH_REQUIRED_MSG } from "@shared/const";

/** Shape of `GET /api/auth/me`. */
export type SessionSnapshot = {
  user: AuthUser | null;
  staffRole: StaffRole | null;
  outletScope: number[] | null;
  /** A refresh cookie exists, so this device can be renewed silently. */
  hasRefresh?: boolean;
  /** Access-token expiry, epoch milliseconds. */
  expiresAt?: number | null;
  remember?: boolean;
};

let lastCheckAt = 0;
let checkInFlight: Promise<boolean> | null = null;

/** Bound the verification probe: an unbounded fetch pinned `checkInFlight` for
 *  ever, which made the 2 s debounce below short-circuit to a promise that could
 *  never settle. */
const PROBE_TIMEOUT_MS = 8000;

/** Verifies a tRPC auth error before bouncing the user to the login page. */
export async function isReallyUnauthenticated(): Promise<boolean> {
  const now = Date.now();
  // Debounce: a burst of failing queries must not hammer /api/auth/me.
  if (now - lastCheckAt < 2_000 && checkInFlight) return checkInFlight;
  lastCheckAt = now;

  const pending = (async () => {
    try {
      const res = await fetch("/api/auth/me", {
        credentials: "include",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      // 503 means the database is unreachable, not that the session ended.
      if (!res.ok) return res.status !== 503;
      const data = (await res.json()) as { user?: unknown };
      return !data?.user;
    } catch {
      // Network failure or timeout must never log the user out.
      return false;
    }
  })();

  checkInFlight = pending;
  try {
    return await pending;
  } finally {
    // Always cleared, even on rejection, so a transient failure cannot wedge the
    // debounce for the rest of the session.
    checkInFlight = null;
  }
}

let lastRedirectAt = 0;

/**
 * Sends the browser to the login page, preserving the intended destination.
 * Throttled, and gated on a server round-trip, so a transient failure cannot
 * produce a redirect loop.
 */
export async function redirectToLoginIfVerified(
  error: { message?: string; data?: { code?: string }; code?: string } | null,
  isTrpcError: boolean
): Promise<void> {
  if (!isTrpcError || !error || typeof window === "undefined") return;

  // Infrastructure failures are retried by the query client, never redirected.
  const code = error.data?.code ?? error.code;
  const unauthorized =
    code === "UNAUTHORIZED" || error.message === AUTH_REQUIRED_MSG;
  if (!unauthorized) return;

  const now = Date.now();
  if (now - lastRedirectAt < 3_000) return;
  if (!(await isReallyUnauthenticated())) return;
  lastRedirectAt = now;

  const current = window.location.pathname + window.location.search;
  if (current.startsWith("/auth/login")) return;
  const target = `/auth/login?returnTo=${encodeURIComponent(current)}`;
  try {
    window.history.replaceState(null, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {
    window.location.replace(target);
  }
}

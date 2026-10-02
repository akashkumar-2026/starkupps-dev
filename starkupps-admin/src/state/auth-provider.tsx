import { csrfHeaders } from "@/api/client";
import type { AuthState, AuthUser, StaffRole } from "@/types";
import { AUTH_UNAVAILABLE_MSG } from "@shared/const";
import { roleCan } from "@shared/permissions";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type AuthContextValue = AuthState & {
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  hasPermission: (perm: string) => boolean;
  canAccessOutlet: (outletId: number) => boolean;
};

const EMPTY = {
  user: null,
  staffRole: null,
  outletScope: null,
  loading: true,
  isAuthenticated: false,
  isAuthorized: false,
  outletDenied: false,
  remember: false,
  expiresAt: null,
  error: null,
} as const;

const AuthContext = createContext<AuthContextValue>({
  ...EMPTY,
  logout: async () => {},
  refresh: async () => {},
  hasPermission: () => false,
  canAccessOutlet: () => false,
});

const AUTH_EVENT = "starkupps:auth-change";

/**
 * Ceiling on a single `/api/auth/me` round-trip.
 *
 * Generous enough for a cold gateway on a slow link, short enough that a hung
 * socket becomes a visible retry button rather than a permanent skeleton.
 */
const SESSION_TIMEOUT_MS = 8000;

export function AuthProvider({ children }: { children: ReactNode }) {
  // main.tsx mounts AuthProvider inside QueryClientProvider, so this is always
  // available. Calling it unconditionally also keeps the hook order stable.
  const queryClient = useQueryClient();

  const [state, setState] = useState<AuthState>({ ...EMPTY });

  /**
   * Exchange the httpOnly refresh cookie for a new access token.
   *
   * The access token is intentionally short-lived (1h by default), while
   * "Remember on this device" lasts 30 days. Without this, a remembered
   * session would silently expire after an hour. The refresh token is an
   * httpOnly cookie, so JavaScript never sees or stores it.
   */
  const rotateSession = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/trpc/auth.refresh?batch=1", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ "0": {} }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const fetchSession = useCallback(async () => {
    /**
     * Every fetch gets its own AbortController and its own deadline.
     *
     * The previous version shared one controller across three fetches and cleared
     * its timer after the first, so the 401-probe and the post-refresh retry ran
     * with no timeout at all. A single hung request therefore left `loading` true
     * for ever, and `ProtectedRoute` rendered the dashboard skeleton for the whole
     * panel with no way out.
     */
    const attemptFetch = async (): Promise<Response> => {
      // Retry once on network/503 (infra), not on 401/403.
      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
        try {
          const res = await fetch("/api/auth/me", {
            credentials: "include",
            signal: controller.signal,
          });
          if (res.status === 503 && attempt === 0) {
            await new Promise(r => setTimeout(r, 500));
            continue;
          }
          return res;
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") throw e;
          if (attempt === 0) {
            await new Promise(r => setTimeout(r, 500));
            continue;
          }
          throw e;
        } finally {
          clearTimeout(timer);
        }
      }
      throw new Error("unreachable");
    };
    try {
      let res = await attemptFetch();
      // The access token has expired but the device still holds a refresh
      // cookie: renew silently rather than bouncing the user to the login page.
      if (res.status === 401) {
        try {
          const probe = await fetch("/api/auth/me", {
            credentials: "include",
            signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
          });
          const probeData = await probe.json();
          if (probeData?.hasRefresh) {
            if (await rotateSession()) {
              res = await attemptFetch();
            }
          }
        } catch {
          // A failed probe just means we cannot refresh; fall through to the
          // signed-out path below rather than hanging.
        }
      }
      if (res.status === 503) {
        // Infra unavailable: keep whatever we knew, stop loading, and say so.
        setState(prev => ({
          ...prev,
          loading: false,
          error: AUTH_UNAVAILABLE_MSG,
        }));
        return;
      }
      if (!res.ok) {
        setState({ ...EMPTY, loading: false });
        return;
      }
      const data = (await res.json()) as {
        user: AuthUser | null;
        staffRole: StaffRole | null;
        outletScope: number[] | null;
        remember?: boolean;
        expiresAt?: number | null;
      };
      if (!data?.user) {
        setState({ ...EMPTY, loading: false });
        return;
      }
      const scope = data.outletScope ?? null;
      // Strict Admin isolation: only owner (admin@starkupps.test) is authorized for Admin panel
      // POS staff (posoperator@starkupps.test) must be blocked from Admin UI (will show 403)
      const isAuthorized = data.staffRole === "owner";
      setState({
        user: data.user,
        staffRole: data.staffRole ?? null,
        outletScope: scope,
        loading: false,
        isAuthenticated: true,
        isAuthorized,
        outletDenied: Array.isArray(scope) && scope.length === 0,
        remember: data.remember === true,
        expiresAt: data.expiresAt ?? null,
        error: null,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        // Timed out. Previously this silently produced "not signed in", which the
        // shell rendered as "awaiting approval" — a dead end with no retry.
        setState(prev => ({
          ...prev,
          loading: false,
          error:
            "Timed out checking your session. Check your connection and retry.",
        }));
        return;
      }
      // Network failure: do NOT log out, keep previous auth state.
      setState(prev =>
        prev.isAuthenticated
          ? {
              ...prev,
              loading: false,
              error:
                "Could not reach the server. Check your connection and retry.",
            }
          : {
              ...EMPTY,
              loading: false,
              error:
                "Could not reach the server. Check your connection and retry.",
            }
      );
    }
  }, [rotateSession]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // Proactive renewal: refresh shortly before the access token lapses so an
  // active shift is never interrupted. Only possible when the device holds a
  // refresh cookie; session-only devices simply re-authenticate next visit.
  useEffect(() => {
    if (!state.isAuthenticated || !state.expiresAt) return;
    const msUntilExpiry = state.expiresAt - Date.now();
    const delay = Math.max(5_000, msUntilExpiry - 5 * 60_000);
    const t = setTimeout(async () => {
      if (await rotateSession()) await fetchSession();
    }, delay);
    return () => clearTimeout(t);
  }, [state.isAuthenticated, state.expiresAt, rotateSession, fetchSession]);

  useEffect(() => {
    let visibleDebounce: ReturnType<typeof setTimeout> | null = null;
    const onStorage = (e: StorageEvent) => {
      if (e.key === AUTH_EVENT) {
        fetchSession();
        if (e.newValue === "logout" && queryClient) queryClient.clear();
      }
    };
    const onCustom = () => fetchSession();
    window.addEventListener("storage", onStorage);
    window.addEventListener(AUTH_EVENT, onCustom);
    // Debounce visibility fetch to avoid rapid refetch when tab toggles quickly (prevents flashing loop)
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (visibleDebounce) clearTimeout(visibleDebounce);
      visibleDebounce = setTimeout(() => fetchSession(), 300);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(AUTH_EVENT, onCustom);
      document.removeEventListener("visibilitychange", onVisible);
      if (visibleDebounce) clearTimeout(visibleDebounce);
    };
  }, [fetchSession, queryClient]);

  const logout = useCallback(async () => {
    // Try tRPC logout (clears httpOnly cookie server-side)
    try {
      await fetch("/api/trpc/auth.logout?batch=1", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ "0": {} }),
      });
    } catch {}
    // Fallback: try non-batch
    try {
      await fetch("/api/trpc/auth.logout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } catch {}
    if (queryClient) queryClient.clear();
    try {
      localStorage.setItem(AUTH_EVENT, "logout");
      localStorage.removeItem(AUTH_EVENT);
    } catch {}
    window.dispatchEvent(new Event(AUTH_EVENT));
    setState({ ...EMPTY, loading: false });
    window.location.href = "/auth/login?reason=signedout";
  }, [queryClient]);

  const refresh = useCallback(async () => {
    await fetchSession();
  }, [fetchSession]);
  const hasPermission = useCallback(
    (perm: string) => roleCan(state.staffRole, perm),
    [state.staffRole]
  );
  const canAccessOutlet = useCallback(
    (outletId: number) => {
      if (state.outletScope === null) return true;
      return state.outletScope.includes(outletId);
    },
    [state.outletScope]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      logout,
      refresh,
      hasPermission,
      canAccessOutlet,
    }),
    [state, logout, refresh, hasPermission, canAccessOutlet]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

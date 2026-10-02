import type { StaffRole } from "./navigation";

/** The signed-in staff member, as returned by `GET /api/auth/me`. */
export type AuthUser = {
  id: number;
  name: string | null;
  email: string | null;
  role: "admin" | "user";
  openId?: string;
};

export type AuthState = {
  user: AuthUser | null;
  staffRole: StaffRole | null;
  /** `null` means every outlet; `[]` means no outlet is assigned yet. */
  outletScope: number[] | null;
  loading: boolean;
  isAuthenticated: boolean;
  isAuthorized: boolean;
  /** True when the scope is `[]` — authenticated but not linked to an outlet. */
  outletDenied: boolean;
  /** The device session is persistent ("Remember on this device"). */
  remember: boolean;
  /** Access-token expiry as epoch milliseconds. */
  expiresAt: number | null;
  /**
   * Set when the session check itself failed (network down, gateway 503, or it
   * timed out). Distinct from "signed out", so the shell can offer a retry
   * instead of showing the misleading "awaiting approval" dead end.
   */
  error: string | null;
};

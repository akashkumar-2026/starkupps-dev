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
};

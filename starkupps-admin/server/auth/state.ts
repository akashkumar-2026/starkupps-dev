import { getOutletScope, resolveStaffRole } from "../db";

export async function getAuthState(
  user: { id: number; role: "user" | "admin"; email?: string | null } | null
) {
  if (!user)
    return {
      user: null,
      staffRole: null,
      outletScope: null as number[] | null,
    };
  try {
    const staffRole = await resolveStaffRole(user);
    const outletScope = await getOutletScope(user);
    return { user, staffRole: staffRole ?? null, outletScope };
  } catch {
    return { user, staffRole: null, outletScope: null as number[] | null };
  }
}

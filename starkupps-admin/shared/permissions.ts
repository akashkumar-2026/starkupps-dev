export type StaffRole = "owner" | "manager" | "staff";

export type Permission =
  | "orders.read"
  | "orders.create"
  | "orders.update"
  | "orders.cancel"
  | "menu.read"
  | "menu.create"
  | "menu.update"
  | "menu.delete"
  | "inventory.read"
  | "inventory.adjust"
  | "inventory.manage"
  | "loyalty.read"
  | "loyalty.update"
  | "analytics.read"
  | "staff.read"
  | "staff.create"
  | "staff.update"
  | "settings.read"
  | "settings.update"
  | "outlets.read"
  | "outlets.create"
  | "outlets.update"
  | "delivery.read"
  | "delivery.assign"
  | "riders.manage"
  | "customers.read"
  | "customers.update"
  | "marketing.read"
  | "marketing.manage"
  | "coupons.read"
  | "coupons.create"
  | "coupons.update"
  | "coupons.pause"
  | "coupons.archive"
  | "coupons.delete"
  | "coupons.analytics"
  | "finance.read"
  | "finance.refund"
  | "finance.expenses"
  | "finance.taxes"
  | "content.read"
  | "content.manage"
  | "support.read"
  | "support.manage"
  | "audit.read";

export const ROLE_PERMISSIONS: Record<StaffRole, Permission[]> = {
  owner: [
    "orders.read",
    "orders.create",
    "orders.update",
    "orders.cancel",
    "menu.read",
    "menu.create",
    "menu.update",
    "menu.delete",
    "inventory.read",
    "inventory.adjust",
    "inventory.manage",
    "loyalty.read",
    "loyalty.update",
    "analytics.read",
    "staff.read",
    "staff.create",
    "staff.update",
    "settings.read",
    "settings.update",
    "outlets.read",
    "outlets.create",
    "outlets.update",
    "delivery.read",
    "delivery.assign",
    "riders.manage",
    "customers.read",
    "customers.update",
    "marketing.read",
    "marketing.manage",
    "coupons.read",
    "coupons.create",
    "coupons.update",
    "coupons.pause",
    "coupons.archive",
    "coupons.delete",
    "coupons.analytics",
    "finance.read",
    "finance.refund",
    "finance.expenses",
    "content.read",
    "content.manage",
    "support.read",
    "support.manage",
    "audit.read",
  ],
  manager: [
    "orders.read",
    "orders.create",
    "orders.update",
    "orders.cancel",
    "menu.read",
    "menu.create",
    "menu.update",
    "inventory.read",
    "inventory.adjust",
    "inventory.manage",
    "loyalty.read",
    "loyalty.update",
    "analytics.read",
    "staff.read",
    "settings.read",
    "outlets.read",
    "outlets.update",
    "delivery.read",
    "delivery.assign",
    "riders.manage",
    "customers.read",
    "customers.update",
    "marketing.read",
    "marketing.manage",
    "coupons.read",
    "coupons.create",
    "coupons.update",
    "coupons.analytics",
    "finance.read",
    "finance.expenses",
    "content.read",
    "content.manage",
    "support.read",
    "support.manage",
    "audit.read",
  ],
  staff: [
    "orders.read",
    "orders.update",
    "menu.read",
    "inventory.read",
    "inventory.adjust",
    "loyalty.read",
    "outlets.read",
    "delivery.read",
    "customers.read",
    "coupons.read",
    "support.read",
  ],
};

export function roleCan(role: StaffRole | null, perm: string): boolean {
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  if ((perms as string[]).includes("*")) return true;
  return (perms as string[]).includes(perm);
}

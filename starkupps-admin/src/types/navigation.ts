import type { LucideIcon } from "lucide-react";

/**
 * Access level assigned by an owner in Staff management. Mirrors
 * `shared/permissions.ts`, which is the authority enforced server-side.
 */
export type StaffRole = "owner" | "manager" | "staff";

/**
 * A workspace surface. Every `/…` route maps onto exactly one view, and the
 * view decides which feature component is rendered inside the admin shell.
 */
export type View =
  | "overview"
  | "orders"
  | "menu"
  | "inventory"
  | "loyalty"
  | "analytics"
  | "staff"
  | "settings"
  | "outlets"
  | "customers"
  | "delivery"
  | "marketing"
  | "instagram"
  | "coupons"
  | "finance"
  | "content"
  | "support"
  | "audit-logs";

export type NavGroup =
  | "workstation"
  | "catalog"
  | "customers"
  | "delivery"
  | "growth"
  | "management"
  | "system";

export type NavItem = {
  view: View;
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string | number;
  group: NavGroup;
};

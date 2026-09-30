import type { NavItem, StaffRole, View } from "@/types";

// Re-exported so layout modules can import navigation and its types together.
export type { NavItem, StaffRole, View };
import {
  BarChart3,
  ClipboardList,
  CreditCard,
  Gift,
  Instagram,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  ScrollText,
  Settings2,
  Soup,
  Store,
  Ticket,
  Truck,
  UsersRound,
  UtensilsCrossed,
  Warehouse,
} from "lucide-react";

export const navigation: NavItem[] = [
  {
    view: "overview",
    label: "Overview",
    href: "/overview",
    icon: LayoutDashboard,
    group: "workstation",
  },
  {
    view: "orders",
    label: "Orders",
    href: "/orders",
    icon: UtensilsCrossed,
    group: "workstation",
  },
  {
    view: "outlets",
    label: "Outlets",
    href: "/outlets",
    icon: Store,
    group: "workstation",
  },
  { view: "menu", label: "Menu", href: "/menu", icon: Soup, group: "catalog" },
  {
    view: "inventory",
    label: "Inventory",
    href: "/inventory",
    icon: Warehouse,
    group: "catalog",
  },
  {
    view: "customers",
    label: "Customers",
    href: "/customers",
    icon: UsersRound,
    group: "customers",
  },
  {
    view: "loyalty",
    label: "Loyalty",
    href: "/loyalty",
    icon: Gift,
    group: "customers",
  },
  {
    view: "delivery",
    label: "Delivery",
    href: "/delivery",
    icon: Truck,
    group: "delivery",
  },
  {
    view: "coupons",
    label: "Coupons",
    href: "/coupons",
    icon: Ticket,
    group: "growth",
  },
  {
    view: "marketing",
    label: "Marketing",
    href: "/marketing",
    icon: Megaphone,
    group: "growth",
  },
  {
    view: "instagram",
    label: "Instagram",
    href: "/instagram",
    icon: Instagram,
    group: "growth",
  },
  {
    view: "staff",
    label: "Staff",
    href: "/staff",
    icon: UsersRound,
    group: "management",
  },
  {
    view: "finance",
    label: "Finance",
    href: "/finance",
    icon: CreditCard,
    group: "management",
  },
  {
    view: "analytics",
    label: "Analytics",
    href: "/analytics",
    icon: BarChart3,
    group: "management",
  },
  {
    view: "content",
    label: "Content",
    href: "/content",
    icon: ClipboardList,
    group: "system",
  },
  {
    view: "support",
    label: "Support",
    href: "/support",
    icon: LifeBuoy,
    group: "system",
  },
  {
    view: "settings",
    label: "Settings",
    href: "/settings",
    icon: Settings2,
    group: "system",
  },
  {
    view: "audit-logs",
    label: "Audit Logs",
    href: "/audit-logs",
    icon: ScrollText,
    group: "system",
  },
];

// Product decision (audit F-29): the Admin panel is intentionally owner-only.
// `auth.login` admits only owner-equivalent accounts and `useAuth.isAuthorized`
// requires `staffRole === "owner"`. The manager/staff capability lists below are
// retained as the target RBAC model (and are enforced for non-Admin surfaces),
// but they are not reachable in this panel today. If the panel is later opened
// to managers/staff, relax the login gate and `isAuthorized`, then add an
// authorization test matrix before shipping.
export const roleCapabilities: Record<StaffRole, View[]> = {
  owner: [
    "overview",
    "orders",
    "outlets",
    "menu",
    "inventory",
    "customers",
    "loyalty",
    "delivery",
    "coupons",
    "marketing",
    "instagram",
    "staff",
    "finance",
    "analytics",
    "content",
    "support",
    "settings",
    "audit-logs",
  ],
  manager: [
    "overview",
    "orders",
    "outlets",
    "menu",
    "inventory",
    "customers",
    "loyalty",
    "delivery",
    "coupons",
    "marketing",
    "instagram",
    "finance",
    "analytics",
    "content",
    "support",
  ],
  staff: [
    "overview",
    "orders",
    "outlets",
    "menu",
    "inventory",
    "delivery",
    "customers",
    "coupons",
    "support",
  ],
};

export function getNavigationForRole(role: StaffRole): NavItem[] {
  const allowed = roleCapabilities[role];
  return navigation.filter(item => allowed.includes(item.view));
}

export function getNavGroupsForRole(role: StaffRole) {
  const items = getNavigationForRole(role);
  const groups: Record<string, NavItem[]> = {};
  for (const it of items) {
    if (!groups[it.group]) groups[it.group] = [];
    groups[it.group].push(it);
  }
  return groups as Record<NavItem["group"], NavItem[]>;
}

export const viewLabels: Record<View, string> = {
  overview: "Overview",
  orders: "Orders",
  outlets: "Outlets",
  menu: "Menu",
  inventory: "Inventory",
  customers: "Customers",
  loyalty: "Loyalty",
  delivery: "Delivery",
  coupons: "Coupons",
  marketing: "Marketing",
  instagram: "Instagram",
  staff: "Staff",
  finance: "Finance",
  analytics: "Analytics",
  content: "Content",
  support: "Support",
  settings: "Settings",
  "audit-logs": "Audit Logs",
};

export function isActiveRoute(
  currentView: View,
  itemView: View,
  pathname: string
): boolean {
  if (currentView === itemView) return true;
  if (itemView === "inventory" && pathname.startsWith("/inventory"))
    return true;
  if (itemView === "orders" && pathname.startsWith("/orders")) return true;
  if (itemView === "loyalty" && pathname.startsWith("/loyalty")) return true;
  if (itemView === "outlets" && pathname.startsWith("/outlets")) return true;
  if (itemView === "customers" && pathname.startsWith("/customers"))
    return true;
  if (itemView === "delivery" && pathname.startsWith("/delivery")) return true;
  if (itemView === "coupons" && pathname.startsWith("/coupons")) return true;
  if (itemView === "marketing" && pathname.startsWith("/marketing"))
    return true;
  if (itemView === "instagram" && pathname.startsWith("/instagram"))
    return true;
  if (itemView === "finance" && pathname.startsWith("/finance")) return true;
  if (itemView === "content" && pathname.startsWith("/content")) return true;
  if (itemView === "support" && pathname.startsWith("/support")) return true;
  return false;
}

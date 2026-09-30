import { getNavGroupsForRole, isActiveRoute } from "@/config/navigation";
import type { NavItem, StaffRole, View } from "@/types";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { trpc } from "@/api/trpc";
import { ChevronUp, LogOut, Settings, ShieldCheck, Store } from "lucide-react";
import { useLocation } from "wouter";

type AppSidebarProps = {
  currentView: View;
  role: StaffRole;
  userName: string;
  onNavigate: (href: string) => void;
  onLogout: () => void;
};

const groupLabels: Record<string, string> = {
  workstation: "Workstation",
  catalog: "Catalog",
  customers: "Customers",
  delivery: "Delivery",
  growth: "Growth",
  management: "Management",
  system: "System",
};

export function AppSidebar({
  currentView,
  role,
  userName,
  onNavigate,
  onLogout,
}: AppSidebarProps) {
  const [location] = useLocation();
  const groups = getNavGroupsForRole(role);
  const order = [
    "workstation",
    "catalog",
    "customers",
    "delivery",
    "growth",
    "management",
    "system",
  ] as const;
  const initials = userName
    .split(/\s+/)
    .map(w => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const notifications = trpc.notifications.list.useQuery(undefined, {
    staleTime: 30_000,
  });
  const unread = notifications.data?.unreadCount ?? 0;

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="py-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="StarKupps — Operations"
              onClick={() => onNavigate("/overview")}
              className="gap-3 rounded-lg data-[state=open]:bg-sidebar-accent"
            >
              <div className="flex size-8 items-center justify-center rounded-lg bg-white text-sidebar shadow-sm">
                <Store className="size-4 text-[#211B18]" />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-bold tracking-tight">
                  STAR/KUPPS
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  Operations
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {order.map((key: NavItem["group"]) => {
          const items = groups[key];
          if (!items || !items.length) return null;
          return (
            <SidebarGroup key={key}>
              <SidebarGroupLabel>{groupLabels[key] ?? key}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map(item => {
                    const Icon = item.icon;
                    const active = isActiveRoute(
                      currentView,
                      item.view,
                      location
                    );
                    const showBadge = item.view === "orders" && unread > 0;
                    return (
                      <SidebarMenuItem key={item.view}>
                        <SidebarMenuButton
                          isActive={active}
                          tooltip={item.label}
                          onClick={() => onNavigate(item.href)}
                        >
                          <Icon />
                          <span>{item.label}</span>
                          {showBadge && (
                            <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[#E2533C] px-1.5 text-xs font-medium tabular-nums text-white group-data-[collapsible=icon]:hidden">
                              {unread > 9 ? "9+" : unread}
                            </span>
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  tooltip={`${userName} — ${role}`}
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg bg-[#C87A5F] text-white">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{userName}</span>
                    <span className="truncate text-xs capitalize text-muted-foreground">
                      {role === "owner"
                        ? "Owner"
                        : role === "manager"
                          ? "Manager"
                          : "Staff"}
                    </span>
                  </div>
                  <ChevronUp className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="end"
                sideOffset={8}
                className="w-56"
              >
                <div className="flex items-center gap-2 p-2">
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg bg-[#C87A5F] text-white">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1">
                    <span className="truncate text-sm font-medium">
                      {userName}
                    </span>
                    <span className="truncate text-xs text-muted-foreground capitalize">
                      {role}
                    </span>
                  </div>
                </div>
                <DropdownMenuItem
                  onClick={() => onNavigate("/settings/security")}
                >
                  <ShieldCheck className="mr-2 size-4" />
                  Security &amp; devices
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onNavigate("/settings")}
                  disabled={role !== "owner"}
                >
                  <Settings className="mr-2 size-4" />
                  Store settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => void onLogout()}
                >
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

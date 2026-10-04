import { viewLabels, type View } from "@/config/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { ViewDialog } from "@/components/shared/dialog";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { trpc } from "@/api/trpc";
import { Bell, CommandIcon, Search, Store } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useOutlet } from "@/state/outlet-provider";
import { RealtimeIndicator } from "@/components/layout/RealtimeIndicator";
import { OrderAlertIndicator } from "@/features/orders/OrderAlertBanner";

type AppHeaderProps = {
  currentView: View;
  activeShiftName: string | null;
};

export function AppHeader({ currentView, activeShiftName }: AppHeaderProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-[#E4DCD1] bg-[#F4F0E9]/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-[#F4F0E9]/95 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1 h-7 w-7 bg-white shadow-sm hover:bg-white" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb className="hidden md:flex">
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink asChild>
                  <Link
                    href="/overview"
                    className="text-[#85796D] hover:text-[#211B18]"
                  >
                    Operations
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block text-[#BAAFA1]" />
              <BreadcrumbItem>
                <BreadcrumbPage className="font-mono-ledger text-[10px] uppercase tracking-[0.12em] text-[#A83825]">
                  {viewLabels[currentView]}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <span className="font-mono-ledger text-[10px] uppercase tracking-[0.12em] text-[#A83825] md:hidden">
            {viewLabels[currentView]}
          </span>
        </div>
        <RealtimeIndicator className="ml-auto" />

        <div className="ml-auto flex items-center gap-2">
          {/* Before the outlet selector: the alert is the reason to look at this
              panel, and it must be visible without scrolling on narrow screens. */}
          <OrderAlertIndicator />
          <OutletSelector />
          <Button
            variant="outline"
            onClick={() => setSearchOpen(true)}
            className="hidden h-9 items-center gap-2 rounded-xl border-[#E4DCD1] bg-white px-3 text-sm font-medium text-[#75695E] shadow-sm hover:bg-[#FCFAF6] hover:text-[#211B18] md:inline-flex"
          >
            <Search className="h-4 w-4 text-[#8E8174]" />
            <span className="hidden lg:inline">Search</span>
            <span className="ml-2 hidden items-center gap-1 rounded-md bg-[#F1EEE8] px-1.5 py-0.5 font-mono-ledger text-[10px] text-[#776C62] lg:flex">
              <CommandIcon className="h-3 w-3" />K
            </span>
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={() => setSearchOpen(true)}
            className="h-9 w-9 rounded-xl border-[#E4DCD1] bg-white shadow-sm md:hidden"
            aria-label="Search"
          >
            <Search className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={() => setNotifOpen(true)}
            className="relative h-9 w-9 rounded-xl border-[#E4DCD1] bg-white shadow-sm"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            <NotificationDot />
          </Button>

          <div className="hidden h-9 items-center gap-2 rounded-xl border border-[#E4DCD1] bg-white px-3 text-xs font-bold text-[#594E45] shadow-sm sm:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="hidden truncate lg:inline">
              {activeShiftName ?? "All shifts"}
            </span>
            <span className="lg:hidden">Shift</span>
          </div>
        </div>
      </header>

      <SearchCommand open={searchOpen} onOpenChange={setSearchOpen} />
      <NotificationSheet open={notifOpen} onOpenChange={setNotifOpen} />
    </>
  );
}

function OutletSelector() {
  const { selectedId, setSelectedId, outlets } = useOutlet();
  const val = selectedId ? String(selectedId) : "all";
  return (
    <Select
      value={val}
      onValueChange={v => setSelectedId(v === "all" ? null : Number(v))}
    >
      <SelectTrigger className="h-9 w-[148px] border-[#E4DCD1] bg-white text-xs shadow-sm md:w-[180px]">
        <Store className="mr-1.5 h-3.5 w-3.5 text-[#8E8174]" />
        <SelectValue placeholder="All Outlets" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Outlets</SelectItem>
        {outlets.map(o => (
          <SelectItem key={o.id} value={String(o.id)}>
            {o.name} — {o.code}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NotificationDot() {
  const q = trpc.notifications.list.useQuery(undefined, { staleTime: 30_000 });
  const c = q.data?.unreadCount ?? 0;
  if (!c) return null;
  return (
    <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#E2533C] px-1 text-[10px] font-bold leading-none text-white">
      {c > 9 ? "9+" : c}
    </span>
  );
}

function SearchCommand({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [, setLocation] = useLocation();
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const search = trpc.search.query.useQuery(
    { q: debouncedQ },
    { enabled: debouncedQ.length >= 2, staleTime: 30_000 }
  );

  const onSelect = (href: string) => {
    onOpenChange(false);
    setQ("");
    setLocation(href);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search orders, menu, inventory, members and staff"
    >
      <CommandInput
        placeholder="Search orders, menu, inventory..."
        value={q}
        onValueChange={setQ}
      />
      <CommandList className="max-h-[50vh]">
        <CommandEmpty>
          {q.trim().length < 2 ? "Type at least 2 characters." : "No results."}
        </CommandEmpty>
        {search.data?.length ? (
          <CommandGroup heading="Results">
            {search.data.map(r => (
              <CommandItem
                key={`${r.type}-${r.id}`}
                value={`${r.title} ${r.subtitle}`}
                onSelect={() => onSelect(r.href)}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.subtitle}
                  </p>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {!q && (
          <CommandGroup heading="Quick links">
            <CommandItem onSelect={() => onSelect("/orders")}>
              Orders — Live queue
            </CommandItem>
            <CommandItem onSelect={() => onSelect("/menu")}>
              Menu — Categories & items
            </CommandItem>
            <CommandItem onSelect={() => onSelect("/inventory")}>
              Inventory — Stock & batches
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}

function NotificationSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const list = trpc.notifications.list.useQuery(undefined, { enabled: open });
  const markAll = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => void utils.notifications.list.invalidate(),
  });
  const markOne = trpc.notifications.markRead.useMutation({
    onSuccess: () => void utils.notifications.list.invalidate(),
  });

  return (
    <ViewDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="Notifications"
      description={`${list.data?.unreadCount ?? 0} unread`}
      headerActions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => markAll.mutate()}
          disabled={markAll.isPending || !list.data?.unreadCount}
        >
          Mark all read
        </Button>
      }
      bodyClassName="space-y-2"
    >
      {list.isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      ) : !list.data?.items.length ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No notifications.
        </p>
      ) : (
        list.data.items.map(n => (
          <div
            key={n.id}
            className="rounded-xl border border-[#E4DCD1] bg-white p-3"
          >
            <p className="text-sm font-semibold">{n.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{n.message}</p>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                {new Date(n.createdAt).toLocaleString()}
              </span>
              {!n.readAt && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => markOne.mutate({ id: n.id })}
                >
                  Mark read
                </Button>
              )}
            </div>
          </div>
        ))
      )}
    </ViewDialog>
  );
}

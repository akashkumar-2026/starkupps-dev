import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BadgeCheck, LayoutGrid, Loader2, MapPin, ReceiptText, Settings2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { PageMeta } from "@/app/PageMeta";
import { Header } from "@/components/layout/Header";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/utils/cn";
import { AddressesTab } from "@/features/profile/components/AddressesTab";
import { OrdersTab } from "@/features/profile/components/OrdersTab";
import { OverviewTab, type DashboardTab } from "@/features/profile/components/OverviewTab";
import { SettingsTab } from "@/features/profile/components/SettingsTab";
import { useSavedAddresses } from "@/features/profile/useAddresses";
import { useRecentOrders } from "@/features/profile/useRecentOrders";
import { useAuth } from "@/state";
import { displayName, initialsOf } from "@/utils/user";
import coverImg from "@/assets/cat-coffee.jpg";

export const Route = createFileRoute("/account")({
  component: Account,
});

type NavItem = {
  id: DashboardTab;
  label: string;
  icon: LucideIcon;
  badge?: (orders: number, addresses: number) => string | null;
};

const NAV: NavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  {
    id: "orders",
    label: "Orders",
    icon: ReceiptText,
    badge: (orders) => (orders > 0 ? String(orders) : null),
  },
  {
    id: "addresses",
    label: "Addresses",
    icon: MapPin,
    badge: (_orders, addresses) => (addresses > 0 ? String(addresses) : null),
  },
  { id: "settings", label: "Settings", icon: Settings2 },
];

function Account() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<DashboardTab>("overview");

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/login" });
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <>
        <Header />
        <main className="grid min-h-[50vh] place-items-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </main>
      </>
    );
  }

  // The redirect above is in flight; render nothing rather than a broken shell.
  if (!user) return null;

  return (
    <>
      <PageMeta
        title="My dashboard"
        description="Orders, addresses and profile settings for your StarKupps account."
        noIndex
      />

      <Header />
      <DashboardBody
        userId={user.id}
        email={user.email ?? null}
        phone={user.phone ?? null}
        name={displayName(user)}
        tab={tab}
        setTab={setTab}
      />
      <SiteFooter />
    </>
  );
}

function DashboardBody({
  userId,
  email,
  phone,
  name,
  tab,
  setTab,
}: {
  userId: string;
  email: string | null;
  phone: string | null;
  name: string;
  tab: DashboardTab;
  setTab: (tab: DashboardTab) => void;
}) {
  const { user } = useAuth();
  const orders = useRecentOrders();
  const { addresses } = useSavedAddresses(userId);

  if (!user) return null;

  const badgeFor = (item: NavItem) => item.badge?.(orders.length, addresses.length) ?? null;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:pt-10">
      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-8">
        {/* ── Sidebar (desktop) ── */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-4">
            <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-card">
              <div className="relative h-24">
                <img
                  src={coverImg}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  width={912}
                  height={1104}
                  className="absolute inset-0 size-full object-cover"
                />
                <span className="absolute inset-0 bg-espresso/35" />
              </div>
              <div className="-mt-10 px-6 pb-6 text-center">
                <Avatar className="mx-auto size-20 ring-4 ring-card">
                  <AvatarFallback className="bg-primary/10 font-display text-2xl font-semibold text-primary">
                    {initialsOf(name)}
                  </AvatarFallback>
                </Avatar>
                <p className="mt-3 truncate font-display text-xl">{name}</p>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {email ?? phone ?? "StarKupps member"}
                </p>
                <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-veg/15 px-3 py-1 text-xs font-semibold text-veg">
                  <BadgeCheck className="size-3.5" />
                  Verified member
                </span>
              </div>
            </div>

            <nav
              className="rounded-3xl border border-border bg-card p-2 shadow-card"
              aria-label="Dashboard"
            >
              {NAV.map(({ id, label, icon: Icon }) => {
                const count = badgeFor({ id, label, icon: Icon });
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    aria-current={tab === id ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-3 rounded-2xl px-4 text-sm font-semibold transition-colors",
                      tab === id
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4.5" />
                    {label}
                    {count ? (
                      <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-xs font-bold tabular-nums text-primary">
                        {count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* ── Main column ── */}
        <div className="min-w-0">
          {/* Mobile profile header */}
          <div className="mb-4 flex items-center gap-3 lg:hidden">
            <Avatar className="size-13 ring-2 ring-primary/20">
              <AvatarFallback className="bg-primary/10 font-display text-lg font-semibold text-primary">
                {initialsOf(name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="eyebrow text-primary">My dashboard</p>
              <p className="truncate font-display text-xl leading-tight">{name}</p>
            </div>
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-veg/15 px-2.5 py-1 text-xs font-semibold text-veg">
              <BadgeCheck className="size-3.5" />
              Verified
            </span>
          </div>

          {/* Mobile tab bar */}
          <div className="material sticky top-16 z-20 -mx-4 mb-5 border-b border-border px-4 py-2 lg:hidden">
            <div
              className="rubber-scroll flex gap-2"
              role="tablist"
              aria-label="Dashboard sections"
            >
              {NAV.map(({ id, label, icon: Icon }) => {
                const count = badgeFor({ id, label, icon: Icon });
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                    className={cn(
                      "flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors",
                      tab === id
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                    {label}
                    {count ? (
                      <span
                        className={cn(
                          "rounded-full px-1.5 text-xs font-bold tabular-nums",
                          tab === id ? "bg-white/25" : "bg-primary/15 text-primary",
                        )}
                      >
                        {count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Desktop heading */}
          <div className="mb-5 hidden lg:block">
            <p className="eyebrow text-primary">My dashboard</p>
            <h1 className="display-lg mt-1">
              {tab === "overview"
                ? `Hello, ${name.split(" ")[0]}`
                : NAV.find((item) => item.id === tab)?.label}
            </h1>
          </div>

          {tab === "overview" ? <OverviewTab user={user} go={setTab} /> : null}
          {tab === "orders" ? <OrdersTab /> : null}
          {tab === "addresses" ? <AddressesTab user={user} /> : null}
          {tab === "settings" ? <SettingsTab user={user} /> : null}
        </div>
      </div>
    </main>
  );
}

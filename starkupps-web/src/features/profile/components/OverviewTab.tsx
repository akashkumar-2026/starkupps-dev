import type { User } from "@supabase/supabase-js";
import { Link } from "@tanstack/react-router";
import { ArrowRight, MapPin, ReceiptText, ShoppingBag, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { inr } from "@/utils/format";
import { useRecentOrders } from "@/features/profile/useRecentOrders";
import { useSavedAddresses } from "@/features/profile/useAddresses";
import type { RecentOrder } from "@/types/profile";
import { EmptyState } from "@/components/shared/EmptyState";
import { displayName } from "@/utils/user";
import { OrderRow } from "./shared";
import heroImg from "@/assets/hero-coffee.jpg";

export type DashboardTab = "overview" | "orders" | "addresses" | "settings";

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <Card className="rounded-3xl shadow-card">
      <CardContent className="flex items-center gap-3 p-4 sm:p-5">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-display text-xl font-semibold tabular-nums">
            {value}
          </span>
          <span className="block text-xs text-muted-foreground">{label}</span>
        </span>
      </CardContent>
    </Card>
  );
}

export function OverviewTab({ user, go }: { user: User; go: (t: DashboardTab) => void }) {
  const orders = useRecentOrders();
  const { addresses } = useSavedAddresses(user.id);
  const spent = orders.reduce((s, o: RecentOrder) => s + o.total, 0);
  const recent = orders.slice(0, 3);

  return (
    <div className="space-y-5">
      {/* Welcome banner — same language as the homepage hero */}
      <div className="relative overflow-hidden rounded-3xl shadow-card">
        <img
          src={heroImg}
          alt=""
          aria-hidden
          loading="eager"
          width={1600}
          height={1200}
          className="absolute inset-0 size-full object-cover"
        />
        <div className="absolute inset-0 bg-espresso/60" />
        <div className="relative p-6 text-espresso-foreground sm:p-8">
          <div className="material inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground">
            <span className="relative grid size-2 place-items-center">
              <span className="absolute size-2 animate-ping rounded-full bg-veg/70" />
              <span className="size-2 rounded-full bg-veg" />
            </span>
            Open now · Closes 11 PM
          </div>
          <h2 className="mt-4 max-w-md font-display text-2xl sm:text-3xl">
            Craving something, {displayName(user).split(" ")[0]}?
          </h2>
          <p className="mt-2 max-w-md text-sm opacity-90">
            Slow-churned cold coffee, hand-stretched pizza and smash burgers — ready in about 9
            minutes.
          </p>
          <Link
            to="/"
            className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-raised"
          >
            <ShoppingBag className="size-4" />
            Order now
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          icon={<ReceiptText className="size-5" />}
          value={String(orders.length)}
          label="Orders placed"
        />
        <StatCard icon={<Wallet className="size-5" />} value={inr(spent)} label="Total savoured" />
        <StatCard
          icon={<MapPin className="size-5" />}
          value={String(addresses.length)}
          label="Saved addresses"
        />
      </div>

      {/* Recent orders */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-lg">Recent orders</h3>
          {orders.length > 3 && (
            <button
              onClick={() => go("orders")}
              className="inline-flex min-h-11 items-center gap-1 px-2 text-sm font-semibold text-primary"
            >
              View all
              <ArrowRight className="size-4" />
            </button>
          )}
        </div>
        {recent.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No orders yet"
            hint="Your confirmed orders will show up here with live status from the kitchen."
            cta={{ label: "Browse the menu", to: "/" }}
          />
        ) : (
          <div className="space-y-3">
            {recent.map((o) => (
              <OrderRow key={o.id} order={o} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

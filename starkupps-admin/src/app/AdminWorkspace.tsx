import { trpc } from "@/api/trpc";
import { AppLayout } from "@/components/layout/AppLayout";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { EmptyPanel, PageLoading } from "@/components/shared/StatePanels";
import { ShiftScopeProvider, type ShiftScope } from "@/state/shift-scope";
import { OutletProvider } from "@/state/outlet-provider";
import { useAuth } from "@/state";
import type { StaffRole, View } from "@/types";
import { roleCapabilities } from "@/config/navigation";
import {
  lazy,
  Suspense,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";

/*
 * Feature hubs are code-split so opening the dashboard does not download every
 * module. Each renders behind a Suspense fallback inside this shell.
 */
const AnalyticsPage = lazy(() => import("@/features/analytics/AnalyticsPage"));
const AuditHub = lazy(() => import("@/features/audit/AuditHub"));
const ContentHub = lazy(() => import("@/features/content/ContentHub"));
const CouponsHub = lazy(() => import("@/features/coupons/CouponsHub"));
const CustomersHub = lazy(() => import("@/features/customers/CustomersHub"));
const DeliveryHub = lazy(() => import("@/features/delivery/DeliveryHub"));
const FinanceHub = lazy(() => import("@/features/finance/FinanceHub"));
const InstagramHub = lazy(() => import("@/features/instagram/InstagramHub"));
const InventoryHub = lazy(() => import("@/features/inventory/InventoryHub"));
const LoyaltyPage = lazy(() => import("@/features/loyalty/LoyaltyPage"));
const MarketingHub = lazy(() => import("@/features/marketing/MarketingHub"));
const MenuPage = lazy(() => import("@/features/menu/MenuPage"));
const OrdersPage = lazy(() => import("@/features/orders/OrdersPage"));
const OutletsHub = lazy(() => import("@/features/outlets/OutletsHub"));
const OverviewPage = lazy(() => import("@/features/overview/OverviewPage"));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage"));
const StaffHub = lazy(() => import("@/features/staff/StaffHub"));
const SupportHub = lazy(() => import("@/features/support/SupportHub"));

type AdminWorkspaceProps = {
  view: View;
  detailId?: number;
};

function roleLabel(role: StaffRole): string {
  return role === "owner"
    ? "Owner"
    : role === "manager"
      ? "Manager"
      : "Kitchen / counter";
}

/**
 * Gates the workspace on a resolved staff profile and the role's capability
 * list, and owns the shift scope every aggregating view reads.
 */
function AccessBoundary({
  children,
  view,
}: {
  children: ReactNode;
  view: View;
}) {
  const {
    user,
    staffRole,
    loading,
    logout,
    outletDenied,
    error: authError,
    refresh,
  } = useAuth();
  const shiftList = trpc.shifts.list.useQuery(undefined, {
    enabled: Boolean(user && staffRole),
  });
  const [shiftScopeId, setShiftScopeId] = useState<number | undefined>();
  const [, setLocation] = useLocation();
  if (loading) return <PageLoading />;
  // The session check itself failed. Previously this collapsed into the same
  // dead end as an unapproved account, so a dropped connection or a gateway 503
  // told the owner their staff profile needed approval — which was never true and
  // left no way forward.
  if (!user && authError) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#F4F0E9] p-5">
        <div className="max-w-md rounded-[18px] border border-[#D8CDC0] bg-[#FCFAF6] p-7 text-center shadow-[0_10px_28px_rgba(55,38,25,0.06)]">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#211B18] text-white text-sm font-bold">
            SK
          </div>
          <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.14em] text-[#A83825]">
            Connection problem
          </p>
          <h1 className="mt-2 text-2xl font-extrabold tracking-[-0.05em]">
            We couldn&apos;t check your session.
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#776A5E]">{authError}</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button onClick={() => void refresh()} className="text-xs">
              Try again
            </Button>
            <Button
              onClick={() => logout()}
              variant="outline"
              className="border-[#D8CDC0] text-xs"
            >
              Sign out
            </Button>
          </div>
        </div>
      </div>
    );
  }
  // ProtectedRoute already handles unauth; this is extra defense
  if (!user || !staffRole) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#F4F0E9] p-5">
        <div className="max-w-md rounded-[18px] border border-[#D8CDC0] bg-[#FCFAF6] p-7 text-center shadow-[0_10px_28px_rgba(55,38,25,0.06)]">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#211B18] text-white text-sm font-bold">
            SK
          </div>
          <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.14em] text-[#A83825]">
            Access pending
          </p>
          <h1 className="mt-2 text-2xl font-extrabold tracking-[-0.05em]">
            Your staff profile needs an owner&apos;s approval.
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#776A5E]">
            Ask a StarKupps owner to add the email address associated with this
            account in Staff management.
          </p>
          <Button
            onClick={() => logout()}
            variant="outline"
            className="mt-6 border-[#D8CDC0] text-xs"
          >
            Sign out
          </Button>
        </div>
      </div>
    );
  }
  const role = staffRole;
  const permitted = roleCapabilities[role].includes(view);
  const scopeLabel = shiftScopeId
    ? (shiftList.data?.find(shift => shift.id === shiftScopeId)?.name ??
      "Selected shift")
    : "All shifts";
  const shiftScope: ShiftScope = {
    shiftId: shiftScopeId,
    label: scopeLabel,
    select: setShiftScopeId,
  };
  return (
    <ShiftScopeProvider value={shiftScope}>
      <SidebarProvider
        style={
          {
            "--sidebar-width": "16rem",
            "--sidebar-width-icon": "3rem",
          } as CSSProperties
        }
      >
        <AppLayout
          currentView={view}
          role={role}
          userName={user.name || "StarKupps staff"}
          activeShiftName={scopeLabel}
          onNavigate={setLocation}
          onLogout={logout}
        >
          {outletDenied && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="font-bold">No outlet assigned</span> — your
              account is not linked to any outlet. Contact an owner to assign
              you to an outlet before operational data will appear.
            </div>
          )}
          {permitted ? (
            children
          ) : (
            <EmptyPanel
              title="This workspace is not included in your role"
              detail={`${roleLabel(role)} access is limited to the operational views you need for your shift.`}
              action={
                <Button
                  onClick={() => setLocation("/orders")}
                  className="bg-[#211B18] text-xs text-white hover:bg-[#3A2D27]"
                >
                  Open live orders
                </Button>
              }
            />
          )}
        </AppLayout>
      </SidebarProvider>
    </ShiftScopeProvider>
  );
}

export default function AdminWorkspace({
  view,
  detailId,
}: AdminWorkspaceProps) {
  return (
    <AccessBoundary view={view}>
      <OutletProvider>
        <Suspense fallback={<PageLoading />}>
          {view === "overview" && <OverviewPage />}
          {view === "orders" && <OrdersPage detailId={detailId} />}
          {view === "menu" && <MenuPage />}
          {view === "inventory" && <InventoryHub detailId={detailId} />}
          {view === "loyalty" && <LoyaltyPage detailId={detailId} />}
          {view === "analytics" && <AnalyticsPage />}
          {view === "staff" && <StaffHub staffId={detailId} />}
          {view === "settings" && <SettingsPage />}
          {view === "outlets" && <OutletsHub detailId={detailId} />}
          {view === "customers" && <CustomersHub detailId={detailId} />}
          {view === "delivery" && <DeliveryHub />}
          {view === "coupons" && <CouponsHub detailId={detailId} />}
          {view === "marketing" && <MarketingHub />}
          {view === "instagram" && <InstagramHub />}
          {view === "finance" && <FinanceHub />}
          {view === "content" && <ContentHub />}
          {view === "support" && <SupportHub detailId={detailId} />}
          {view === "audit-logs" && <AuditHub />}
        </Suspense>
      </OutletProvider>
    </AccessBoundary>
  );
}

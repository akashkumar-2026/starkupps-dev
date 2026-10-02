import {
  ProtectedRoute,
  PublicOnlyRoute,
} from "@/components/auth/ProtectedRoute";
import type { View } from "@/types";
import { lazy, Suspense, type ReactNode } from "react";
import { Route, Switch } from "wouter";

import ForbiddenPage from "./pages/ForbiddenPage";
import NotFoundPage from "./pages/NotFoundPage";
import { PageLoading } from "@/components/shared/StatePanels";
import AdminWorkspace from "./AdminWorkspace";

/*
 * Sign-in and password flows are small and rarely visited, so they load on
 * demand. Everything else renders inside the workspace shell, which is already
 * on the critical path.
 */
const LoginPage = lazy(() => import("@/features/auth/LoginPage"));
const ForgotPasswordPage = lazy(
  () => import("@/features/auth/ForgotPasswordPage")
);
const ResetPasswordPage = lazy(
  () => import("@/features/auth/ResetPasswordPage")
);
const ChangePasswordPage = lazy(
  () => import("@/features/auth/ChangePasswordPage")
);
const SecuritySessionsPage = lazy(
  () => import("@/features/settings/SecuritySessionsPage")
);
const SiteContentSettingsPage = lazy(
  () => import("@/features/settings/SiteContentSettingsPage")
);

const withSuspense = (node: ReactNode) => (
  <Suspense fallback={<PageLoading />}>{node}</Suspense>
);

const guard = (node: ReactNode) =>
  withSuspense(<ProtectedRoute>{node}</ProtectedRoute>);

/** Every `/inventory/*` sub-route renders the same hub with a detail target. */
const workspace = (view: View, detailId?: number) =>
  guard(<AdminWorkspace view={view} detailId={detailId} />);

export function AppRoutes() {
  return (
    <Switch>
      {/* Public auth routes */}
      <Route path="/auth/login">
        <PublicOnlyRoute>
          <LoginPage />
        </PublicOnlyRoute>
      </Route>
      <Route path="/login">
        <PublicOnlyRoute>
          <LoginPage />
        </PublicOnlyRoute>
      </Route>
      <Route path="/auth/forgot-password">
        {withSuspense(<ForgotPasswordPage />)}
      </Route>
      <Route path="/auth/reset-password">
        {withSuspense(<ResetPasswordPage />)}
      </Route>
      <Route path="/auth/change-password">
        {guard(<ChangePasswordPage />)}
      </Route>
      {/* Personal security: active devices + password. Available to any
          authenticated admin, not gated on the "owner" role, because a user
          must always be able to review and revoke their own sessions. */}
      <Route path="/settings/security">{guard(<SecuritySessionsPage />)}</Route>
      <Route path="/403" component={ForbiddenPage} />

      {/* Workspace */}
      <Route path="/">{workspace("overview")}</Route>
      <Route path="/overview">{workspace("overview")}</Route>
      <Route path="/orders">{workspace("orders")}</Route>
      <Route path="/orders/:id">
        {params => workspace("orders", Number(params.id))}
      </Route>
      <Route path="/menu">{workspace("menu")}</Route>
      <Route path="/inventory">{workspace("inventory")}</Route>
      <Route path="/inventory/materials">{workspace("inventory")}</Route>
      <Route path="/inventory/materials/:id">
        {params => workspace("inventory", Number(params.id))}
      </Route>
      <Route path="/inventory/items/:id">
        {params => workspace("inventory", Number(params.id))}
      </Route>
      <Route path="/inventory/prepared-items">{workspace("inventory")}</Route>
      <Route path="/inventory/recipes">{workspace("inventory")}</Route>
      <Route path="/inventory/movements">{workspace("inventory")}</Route>
      <Route path="/inventory/purchases">{workspace("inventory")}</Route>
      <Route path="/inventory/purchase-orders">{workspace("inventory")}</Route>
      <Route path="/inventory/suppliers">{workspace("inventory")}</Route>
      <Route path="/inventory/transfers">{workspace("inventory")}</Route>
      <Route path="/inventory/wastage">{workspace("inventory")}</Route>
      <Route path="/inventory/low-stock">{workspace("inventory")}</Route>
      <Route path="/inventory/transactions">{workspace("inventory")}</Route>
      <Route path="/inventory/analytics">{workspace("inventory")}</Route>
      <Route path="/inventory/attention">{workspace("inventory")}</Route>
      <Route path="/loyalty">{workspace("loyalty")}</Route>
      <Route path="/loyalty/:id">
        {params => workspace("loyalty", Number(params.id))}
      </Route>
      <Route path="/analytics">{workspace("analytics")}</Route>
      <Route path="/staff">{workspace("staff")}</Route>
      <Route path="/staff/all">{workspace("staff")}</Route>
      <Route path="/staff/roles">{workspace("staff")}</Route>
      <Route path="/staff/attendance">{workspace("staff")}</Route>
      <Route path="/staff/shifts">{workspace("staff")}</Route>
      <Route path="/staff/leave">{workspace("staff")}</Route>
      <Route path="/staff/performance">{workspace("staff")}</Route>
      <Route path="/staff/activity">{workspace("staff")}</Route>
      <Route path="/staff/:id">
        {params => workspace("staff", Number(params.id))}
      </Route>
      <Route path="/settings">{workspace("settings")}</Route>
      <Route path="/settings/site">{guard(<SiteContentSettingsPage />)}</Route>
      <Route path="/outlets">{workspace("outlets")}</Route>
      <Route path="/outlets/:id">
        {params => workspace("outlets", Number(params.id))}
      </Route>
      <Route path="/customers">{workspace("customers")}</Route>
      <Route path="/customers/:id">
        {params => workspace("customers", Number(params.id))}
      </Route>
      <Route path="/customers/segments">{workspace("customers")}</Route>
      <Route path="/delivery">{workspace("delivery")}</Route>
      <Route path="/delivery/riders">{workspace("delivery")}</Route>
      <Route path="/delivery/live">{workspace("delivery")}</Route>
      <Route path="/delivery/assignments">{workspace("delivery")}</Route>
      <Route path="/coupons">{workspace("coupons")}</Route>
      <Route path="/coupons/new">{workspace("coupons")}</Route>
      <Route path="/coupons/:id">
        {params => workspace("coupons", Number(params.id))}
      </Route>
      <Route path="/marketing">{workspace("marketing")}</Route>
      <Route path="/marketing/coupons">{workspace("marketing")}</Route>
      <Route path="/marketing/campaigns">{workspace("marketing")}</Route>
      <Route path="/marketing/offers">{workspace("marketing")}</Route>
      <Route path="/marketing/banners">{workspace("marketing")}</Route>
      <Route path="/instagram">{workspace("instagram")}</Route>
      <Route path="/finance">{workspace("finance")}</Route>
      <Route path="/finance/revenue">{workspace("finance")}</Route>
      <Route path="/finance/transactions">{workspace("finance")}</Route>
      <Route path="/finance/refunds">{workspace("finance")}</Route>
      <Route path="/finance/expenses">{workspace("finance")}</Route>
      <Route path="/finance/taxes">{workspace("finance")}</Route>
      <Route path="/content">{workspace("content")}</Route>
      <Route path="/support">{workspace("support")}</Route>
      <Route path="/support/:id">
        {params => workspace("support", Number(params.id))}
      </Route>
      <Route path="/audit-logs">{workspace("audit-logs")}</Route>
      <Route path="/404" component={NotFoundPage} />
      <Route component={NotFoundPage} />
    </Switch>
  );
}

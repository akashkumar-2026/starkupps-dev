# StarKupps — Target Production Architecture

**Date:** 2026-09-26
**Basis:** `docs/STARKUPPS-PRODUCTION-AUDIT.md` (verified current state). This document defines the production target and the migration path from the audited state. It deliberately **preserves** the working server-authoritative gateway rather than rewriting it.

---

## Guiding principles

1. **Do not rewrite what works.** The admin Express/tRPC gateway, custom JWT auth + `sessionVersion` revocation, Supabase Postgres, and the storefront are sound. Changes are additive/hardening.
2. **One data plane.** All privileged access goes through `starkupps-admin/server` using the service-role client. The browser never holds privileged credentials.
3. **Server/database authorization over UI-only.** Authorization is enforced in SQL/RLS and in tRPC procedures; the UI mirrors it but never is it.
4. **Realtime only where it adds value.** Catalog sync for the storefront; targeted operational updates for admin. No "subscribe to everything".
5. **No fake production data.** Reference/config data is seeded into real tables; fallbacks that invent records are deleted.
6. **Migrations are the only schema path.** Every change is a new file in `supabase/migrations`, applied with `supabase db push --linked`.

---

## 1. Frontend

### starkupps-admin
- **Structure**: unchanged (wouter + module components + `AdminApp` shell).
- **Data layer**: tRPC React client (`/api/trpc`) + TanStack Query. Introduce explicit query keys and `staleTime`; keep invalidation for mutations; keep existing optimistic updates for order status.
- **Auth layer**: `useAuth` → `/api/auth/me`. Keep owner-only admin gate (matches server). Do **not** claim manager/staff support in the UI while the server disallows it; either enable the server policy or remove the dead capability matrix. **Decision:** keep owner-only for now and document it; the permission matrix remains the server-side model for future roles.
- **Authorization (UI)**: keep route guards + `roleCapabilities`; add pending-disable on all mutation buttons (fix duplicate-submit gaps); fix the `staff.schedules.remove` no-op.
- **Realtime**: replace polling where it matters. Because operational tables are not anon-readable, admin realtime is delivered by **server-brokered Supabase Realtime Broadcast** (the gateway runs a Realtime client with the service-role/authenticated token and broadcasts to per-outlet topics), or short-interval polling as a fallback. Target topics: `outlet:{id}:orders`, `outlet:{id}:deliveries`, `user:{id}:notifications`.
- **Errors/loading**: every query gets loading/empty/error(+retry) states; remove silent error swallowing.
- **Forms**: migrate module forms to react-hook-form + zod (shared schemas where possible); disable submit on `isPending` everywhere.

### starkupps-web
- **Structure**: unchanged (TanStack Start/Router). Keep SSR gate for `usePublicMenu`.
- **Data layer**: `publicApi.ts` REST-first, tRPC fallback. Fix `trpcPost` error-message bug. Keep TanStack Query.
- **Auth layer**: keep Supabase Auth for customers. Add a `beforeLoad` guard for `/account` (server-safe) so protection is not only client-side. Note that customer identities currently do not link to `public.users`; document this and (future) add an optional linkage table.
- **Realtime**: keep `subscribeMenu` (catalog) and outlets. Add customer order-status subscription filtered by `order.id` for `/account` tracking.
- **Mock removal**: replace hardcoded marketing KPIs/trust/gallery with `content_blocks`/`testimonials`/`faqs` (already available via gateway) or accept them as static brand copy explicitly marked as such. Remove `ComponentShowcase`/`DashboardLayout` dead code.
- **PII**: keep localStorage convenience cache but reduce fields, namespace, and clear on sign-out.

---

## 2. Supabase

### Database schema (target hardening)
- Add missing FKs where safe and meaningful: `orders(customerId→customers, outletId→outlets)`, `order_items(orderId→orders ON DELETE CASCADE, menuItemId→menu_items)`, `payments.orderId`, `refunds.orderId`, `deliveries.orderId`, `coupon_redemptions(couponId, orderId)`, `notifications.recipientUserId`, `audit_log.actorUserId`, `outlet_staff.staffId→staff`, `inventory_transactions.inventoryItemId`.
- Convert high-traffic status columns to enums (or add CHECK constraints) for `orders.status`, `orders.paymentStatus`, `payments.status`, `refunds.status`, `deliveries.status`, `purchase_orders.status`, `support_tickets.status`, `coupons.status`.
- Add `updatedAt` triggers where missing; keep `createdAt` everywhere.
- Add indexes based on actual queries: `orders(outletId,status,createdAt desc)`, `orders(customerId)`, `order_items(orderId)`, `coupon_redemptions(couponId,customerId,status)`, `coupon_redemptions(idempotencyKey)`, `customers(phone) unique`, `deliveries(orderId)`, `menu_items(categoryId)`, `menu_item_variants(menuItemId)`, `audit_log(entityType,action,createdAt desc)`, `notifications(recipientUserId,readAt)`.
- Seed reference data (migration, not app fallback): `workforce_roles`, `workforce_permissions`, `workforce_role_permissions`, `loyalty_rules`, default `store_settings`, default `customer_segments`.
- Persist order idempotency independent of coupons: write `orders.idempotencyKey` on every order (unique index already exists).

### RLS (target — mandatory)
- **Deny-by-default** for `anon` and `authenticated` on all operational/sensitive tables (already the case).
- **Enable RLS on the public catalog tables** and grant **SELECT only** to `anon`/`authenticated` for the rows Realtime must publish:
  - Public read: `menu_categories`, `menu_items`, `menu_item_variants`, `modifier_groups`, `modifier_options`, `menu_item_modifiers`, `outlets` (status='active'), `outlet_hours`, `outlet_menu_availability`, `outlet_variant_availability`.
  - **No INSERT/UPDATE/DELETE** policies for anon/authenticated (service_role writes).
- Keep auth tables (`sessions`, `password_resets`, `csrf_tokens`, `session_limits`, `rate_limits`) with `TO service_role` policies only.
- Do **not** use `USING (true)` outside a documented public-read requirement (catalog tables above) or a `TO service_role` policy.
- Identity-based policies using `auth.uid()` are only meaningful once Supabase Auth is linked to app tables; until then the gateway is the authority and RLS is defense-in-depth (deny-anon + public-read allowlist).

### Storage
- Keep buckets public-read. **Remove** `authenticated` INSERT/UPDATE/DELETE policies; keep public `SELECT` and `service_role` ALL. All uploads go through the gateway (already the case). Add server-side magic-byte MIME sniffing and enforce the 5 MB decoded limit before upload.

### Realtime
- Web: keep table-based `postgres_changes` for catalog/outlets (requires the public-read policies above).
- Admin: server-brokered Broadcast (or polling fallback) because operational tables stay deny-anon.
- Remove dropped `pos_sessions` remnants from any publication references (already dropped with the table).

### Auth
- Keep custom admin JWT. **Fix** Argon2 verification. Either implement real refresh rotation or remove the advertised-but-unused refresh cookie and document 7-day access tokens. Target: add `/api/auth/refresh` using `sessions.token_hash` + rotation/reuse detection, or drop the refresh cookie to avoid a false security claim.

### Functions / triggers / edge functions
- Keep `update_updated_at` triggers and `cleanup_expired_rate_limits`.
- Add `set_updated_at` coverage; add a `bump_session_version`-style helper only if needed.
- **No edge functions** unless a scheduled job (session/rate-limit cleanup) is required — prefer `pg_cron` via migration if available.

---

## 3. Data flow (target)

### Storefront order
```
UI (CartSheet)
→ client Zod validation (checkout.ts)
→ publicApi.createPublicOrder (REST /api/public/orders)
→ gateway public.orders.create
   → rate limit (persistent)
   → load menu/variant/modifier/availability from Postgres (service_role)
   → recompute authoritative prices (modifier deltas from DB only)
   → coupon revalidation
   → sql.begin transaction: order + order_items + customer + coupon_redemption + idempotency
→ Postgres commit
→ Realtime postgres_changes (orders)
→ (future) customer order-status subscription → targeted cache update
→ UI success
```

### Admin operational update
```
UI action
→ tRPC mutation (protectedProcedure + permission + outlet scope)
→ validation (zod)
→ sql.begin transaction where multi-table
→ audit_log
→ Realtime Broadcast to outlet:{id}:orders (server-brokered)
→ React Query cache patch/invalidation
→ UI update
```

### Menu change (admin → web)
```
admin mutation (menu.*)
→ Postgres commit (menu_items / menu_item_variants / modifier_*)
→ Realtime postgres_changes (public catalog table)
→ web subscribeMenu debounced
→ invalidate ["public","menu",outletId]
→ rebuild menu UI
```

---

## 4. Authorization model (target enforcement)

Every protected procedure must:
1. authenticate (`protectedProcedure`, admin audience),
2. check a **specific** permission (`roleCan("orders.create")`, not the legacy `"orders"` key),
3. resolve `getOutletScope`,
4. call `assertOutletAccess(user, outletId)` for any outlet-scoped read/write, and filter list queries by scope,
5. fail **closed** when scope is `[]` (no assignments).

Legacy `roleCan("orders")`-style coarse checks must be replaced with the granular permission catalog. `adminProcedure` should be a real alias with identical semantics (documented) or removed.

---

## 5. Performance targets
- Menu: server-side cached at gateway + Realtime invalidation; one query per outlet.
- Admin lists: cursor pagination everywhere (CustomersHub pagination must be real); server-side filtering/sorting.
- Dashboard: SQL aggregates (`count`, `sum`, `group by`) instead of loading 5000 rows in JS.
- Indexes per §2.
- Avoid N+1: batch enrichment with `.in(...)`.
- Realtime: targeted filters, debounce, direct cache patch, proper unsubscribe.

---

## 6. Migration path (incremental, safe)

1. **Critical security** (Phase 19.1): Argon2 fix; RLS catalog/storage migration; secret rotation + history purge; public order hardening; real transactions; missing outlet authorization.
2. **Schema consistency** (19.2): FKs, enums/CHECKs, indexes, seed reference data.
3. **Supabase integration repair** (19.3): idempotency persistence; public REST error mapping; storage MIME sniffing.
4. **Auth** (19.4): refresh rotation decision + implementation; session last_used touch.
5. **Authz/RLS** (19.5): granular permission checks everywhere.
6. **Data-access layer** (19.6): shared query helpers; batch enrichment.
7. **Mock removal** (19.7): M1–M16.
8. **Mutations** (19.8): real pagination; fix no-op mutations; pending-disable.
9. **Realtime** (19.9): targeted admin broadcast/polling; customer order status.
10. **States/optimization** (19.10–12).
11. **Tests + final audit** (19.13–14).

Each step is independently deployable and must keep `npx tsc --noEmit` and `npx vitest run` green in `starkupps-admin`, and `npx tsc --noEmit` green in `starkupps-web`.

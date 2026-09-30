# StarKupps — Production Audit

**Repository:** `C33293-STARKUPPS-PROD`
**Date:** 2026-09-26
**Scope:** `starkupps-admin` (gateway + admin SPA), `starkupps-web` (customer storefront), `supabase/` (schema, migrations, RLS, storage, realtime)
**Method:** full source read; no changes were made to produce this audit. Every claim below is traceable to a file in the repository.

> This audit supersedes the stale root docs. `starkupps-admin/architecture.md` still describes a MySQL/Drizzle stack that no longer exists; `starkupps-admin/audit.md` and `inventory-audit.md` describe an earlier prototype. The repository's own migrations and server code are the source of truth.

---

## A. Project Understanding

### What the application actually is
StarKupps is a café/quick-service restaurant business (Munger, Bihar) with:

1. **A public storefront** (`starkupps-web`) where customers browse a menu, choose an outlet, build a cart (takeaway / delivery / dine-in), apply coupons, and place an order.
2. **An operations/admin console** (`starkupps-admin`) used by the business owner to manage orders, menu, inventory, staff, outlets, coupons, marketing, finance, delivery, support, content, and audit logs.
3. **A single server gateway** (`starkupps-admin/server`) exposing tRPC (`/api/trpc`) for the admin console and a small public REST/tRPC surface (`/api/public/*`, `public.*`) for the storefront.
4. **A Supabase Postgres database** that is the single source of truth, plus Supabase Storage (image buckets) and Supabase Realtime (storefront menu sync + customer auth).

A third app, `starkupps-pos` (counter point-of-sale), was **decommissioned** in commit `ce306fb`; its tables (`pos_terminals`, `pos_sessions`, `cash_drawers`, `cash_movements`) and `staff.posPin*` columns were dropped in `20260925000002_pos_decommission.sql`. The admin gateway is now the only data plane.

### Users
- **Owner** — full access. This is effectively the only role able to obtain an admin session today (see §E).
- **Manager** / **Staff** — a full role/permission matrix exists (`shared/permissions.ts`) but is currently unreachable for admin login.
- **Customer** — anonymous storefront visitor, or a Supabase-Auth-registered customer (email/password) who gets a saved account view.

### Major workflows
- **Storefront order**: browse menu (live from gateway + Realtime) → select outlet → cart → coupon validation → checkout form → `public.orders.create` (server re-prices from DB) → order persisted; recent orders cached in browser `localStorage`.
- **Admin order management**: list/detail/status transition/cancel + manual order intake.
- **Menu management**: categories, items, variants (price lives on variants), modifiers, availability, coming-soon, image upload.
- **Inventory**: items, categories, suppliers, batches, adjustments/waste/receipts, purchase orders, transfers, recipes, alerts.
- **Staff/workforce**: staff records, roles, attendance, schedules, leave, performance, activity.
- **Outlets**: creation, hours, delivery zones, menu availability, closures.
- **Coupons/marketing**: coupons with eligibility/outlet/product rules, offers, campaigns, banners.
- **Finance**: revenue, transactions, refunds, expenses, taxes, payouts.
- **Support/Content/Audit**: tickets, CMS blocks/FAQs/testimonials, audit log.

### Major entities (tables)
~70 tables. Core: `users`, `staff`, `outlet_staff`, `outlets`, `customers`, `orders`, `order_items`, `menu_categories`, `menu_items`, `menu_item_variants`, `modifier_groups`, `modifier_options`, `menu_item_modifiers`, `coupons`, `coupon_redemptions`, `payments`, `refunds`, `inventory_items`, `inventory_transactions`, `inventory_batches`, `purchase_orders`, `purchase_order_lines`, `suppliers`, `recipes`, `recipe_components`, `deliveries`, `riders`, `support_tickets`, `audit_log`, `store_settings`, `notifications`, `sessions`, `password_resets`, `rate_limits`.

### Important business rules (confirmed in code)
- **Variant is the only sellable price.** `menu_items.price` was dropped in `20250904120008_remove_base_price.sql`; price lives on `menu_item_variants`.
- **Order pricing is server-authoritative** (`publicRouter.orders.create`): menu, variant, availability, coming-soon, coupon eligibility, and charges are all recomputed server-side.
- **Owner-only admin login** (`server/routers.ts:162-172`): non-`admin` users must resolve `staffRole === "owner"` to sign in.
- **Charges are hardcoded**: packing ₹15 (non dine-in), delivery ₹29, taxes = 0 (`publicRouter.ts:640-651`).
- **comingSoon** blocks ordering server-side for the item and its category.

### Existing architecture (as-built)
| Layer | Implementation |
|---|---|
| Admin UI | React 19 + Vite + wouter, tRPC React client, TanStack Query, shadcn/Radix, Tailwind v4 |
| Gateway | Node + Express 4, tRPC 11 (`/api/trpc`), public REST mirrors (`/api/public/*`), static SPA host |
| Data access | `@supabase/supabase-js` service-role client (primary) + `postgres` (raw, for transactions) |
| DB | Supabase Postgres, migrations in `supabase/migrations` |
| Admin auth | Custom JWT (`jose`, HS256) in httpOnly cookie `app_session_id` + `sessionVersion` revocation |
| Customer auth | Supabase Auth (GoTrue), stored in browser `localStorage` |
| Realtime | Supabase Realtime `postgres_changes` (storefront menu/outlets only) |
| Storage | Supabase Storage buckets `product-images`, `category-images` (public read; server-side service-role uploads) |

### Authorization architecture
- `shared/permissions.ts` defines 39 permissions and three roles with a granular matrix.
- Server: `resolveStaffRole` + `getOutletScope` + `assertOutletAccess` + `roleCan`.
- `protectedProcedure` verifies only "is logged in and not POS-audience". It does **not** check role/permission.
- Individual routers call permission helpers, but coverage is inconsistent (see §C/§F).

### Current Supabase architecture
- **Schema**: 24 migrations, applied via Supabase CLI (`supabase db push --linked`). Project reference is in `supabase/.temp/project-ref`; secrets are in `.env` files (untracked).
- **RLS**: enabled on ~35 sensitive tables. Migration `20250904120006_rls_tighten.sql` intentionally removed all `anon`/`authenticated` policies, leaving *deny-by-default*; the app server uses `service_role`, which bypasses RLS. Auth-table policies were later scoped `TO service_role` (`20260925000000_rls_repair.sql`). **Critically, the catalog tables used by storefront Realtime have RLS disabled entirely** (see §D/§F).
- **Storage**: 3 buckets. `product-images` and `category-images` are public-read with `authenticated` insert/update/delete policies; `starkupps` bucket is public with `authenticated` write policies.
- **Realtime**: `supabase_realtime` publication includes `orders, order_items, deliveries, menu_items, menu_item_variants, outlet_menu_availability, outlet_variant_availability, menu_categories, modifier_groups, modifier_options, menu_item_modifiers, outlets, outlet_hours`. `pos_sessions` was in the publication but its table was dropped.
- **Auth (Supabase GoTrue)**: `auth.enabled = true`, `enable_signup = true`, `enable_confirmations = false`, `site_url = http://127.0.0.1:3000`. Used only by the storefront; **the admin gateway does not use Supabase Auth at all**.

---

## B. Application Structure

### starkupps-admin
- **Client** (`starkupps-admin/client/src`): single-page app, wouter routes in `App.tsx`, shell in `components/AdminApp.tsx` + `components/layout/*`, one component per module in `components/modules/*` and `components/InventoryHub.tsx`. Auth guard `components/auth/ProtectedRoute.tsx`. tRPC client `lib/trpc.ts`; `_core/hooks/useAuth.tsx` fetches `/api/auth/me`.
- **Server** (`starkupps-admin/server`): `index.ts` (Express/CORS/CSRF/security headers/static), `routers.ts` (mounts everything + inline `auth` router), ~17 feature routers, `_core/*` (auth, sessions, cookies, env, rateLimit, supabase, trpc, mailer, authState), `db.ts`, `storage.ts`.
- **Shared** (`starkupps-admin/shared`): `permissions.ts`, `const.ts`, `types.ts`, `supabase.types.ts` (generated), India location data.

### starkupps-web
- Vite + TanStack Start (SSR) + TanStack Router (file-based) + TanStack Query + Tailwind v4 + Motion.
- `src/routes/*` (8 routes), `src/components/*` (domain + shadcn ui), `src/lib/*` (publicApi, supabase realtime, auth, cart, outlet, profile), `src/hooks/usePublicMenu.ts`.
- No own backend: `src/server.ts` is only the SSR entry. All business data comes from the admin gateway (`VITE_API_URL`) via REST/tRPC; menu/outlets also come over Supabase Realtime directly.

### Shared / duplicated logic
- **Shared**: `@shared/permissions` is shared between admin server and client; `superjson` used on both tRPC ends; India data.
- **Duplicated/parallel concerns**:
  - Two independent auth systems (admin custom JWT vs storefront Supabase Auth) with no linking between `public.users` (admin) and `auth.users` (Supabase). A storefront customer and an admin user are different identities even for the same email.
  - Two cart/pricing implementations: `starkupps-web/src/lib/cart.tsx` (client display) and `publicRouter.orders.create` (authoritative). They are intentionally mirrored but diverge (charges duplicated, taxes 0).
  - Types: `shared/types.ts` carries legacy Drizzle-era types; `shared/supabase.types.ts` is the generated DB shape; `shared/types.supabase.ts` also exists. Overlap/duplication.
  - `starkupps-admin/architecture.md`, `audit.md`, `inventory-audit.md`, `todo.md`, `ideas.md` are stale relative to the code.

### Routing / state / data access / components / forms / validation / error handling
- **Admin routing**: wouter with many deep-link paths; view dispatch in `AdminApp.tsx:200-224`; nav config in `config/navigation.ts`.
- **State**: TanStack Query (server state) + React context (`OutletContext`, `ThemeContext`, auth). No global store.
- **Forms/validation (admin)**: **no react-hook-form/zod in application code** (installed but only used by unused `ui/form.tsx`). Validation is ad-hoc `useState` + `toast.error`. Duplicate-submit protection is a button `disabled={isPending}` in most dialogs but **missing** in several (ContentHub, MarketingHub offers/campaigns/banners, Support create, Staff leave/assign/role, Coupons status/delete, refund transitions, rider assign).
- **Forms/validation (web)**: checkout uses RHF + Zod (`lib/validation/checkout.ts`); auth/address/settings use manual checks.
- **Error handling**: inconsistent. Admin root `ErrorBoundary` + QueryClient redirect interceptor. Several modules silently hide errors (Coupons KPI returns `null`; ContentHub/MarketingHub/Delivery/Finance sub-tabs have no error branch). Web `reportError` is a console-only stub.
- **Loading states**: broadly present (skeletons in web; spinners/panels in admin). Empty states broadly present.

---

## C. Backend / Data Audit

### Tables referenced by server code (67)
`attendance_records, audit_log, banners, campaigns, content_blocks, coupon_redemptions, coupons, customer_feedback, customer_segments, customers, deliveries, delivery_zones, expenses, faqs, inventory_alert_acknowledgements, inventory_batches, inventory_categories, inventory_items, inventory_transactions, leave_requests, loyalty_rules, loyalty_transactions, menu_categories, menu_item_ingredients, menu_item_modifiers, menu_item_variants, menu_items, menu_variant_ingredients, modifier_groups, modifier_options, notifications, offers, order_items, orders, outlet_closures, outlet_hours, outlet_menu_availability, outlet_staff, outlet_variant_availability, outlets, password_resets, payments, payouts, prepared_item_batches, prepared_items, purchase_order_lines, purchase_orders, rate_limits, recipe_components, recipes, refunds, riders, sessions, shift_templates, shifts, staff, staff_schedules, stock_transfer_items, stock_transfers, store_settings, suppliers, support_messages, support_tickets, taxes, testimonials, users, wastage_records, workforce_permissions, workforce_role_permissions, workforce_roles`.

### Tables defined but effectively unused
`menu_item_ingredients` (only raw SQL in `publicRouter`, superseded by `menu_variant_ingredients`), `prepared_item_batches` (referenced), `csrf_tokens`/`session_limits`/`session_limits` (created by `auth_hardening` but not used by app code), `session_limits`, `banners` (also exposed via contentRouter).

### Missing tables / gaps
- No table for **customer↔Supabase-Auth linkage** (storefront accounts are invisible to admin).
- No **order status history** table (status changes overwrite `orders.status`; only `audit_log` keeps a trail).
- No **tax snapshot** on orders; taxes table exists but is never applied.
- No **idempotency persistence without a coupon** — `orders.idempotencyKey` exists (`20260925000001`) but `publicRouter` stores the key only inside `coupon_redemptions` (see §F).

### Duplicate entities
- `menu_item_ingredients` vs `menu_variant_ingredients`.
- `offers`/`campaigns` vs `coupons` overlapping discount concepts.
- `shared/types.ts` legacy types vs generated `supabase.types.ts`.

### Foreign keys / indexes / constraints / enums / timestamps
- FKs exist on the core menu/order/inventory relationships. **Many logical relations have no FK**: `orders.outletId`, `orders.customerId`, `order_items.orderId/menuItemId`, `audit_log.actorUserId`, `notifications.recipientUserId`, `deliveries.orderId`, `inventory_transactions.createdBy`, `outlet_staff`→`staff` etc. (FKs were largely lost in the Drizzle→Supabase baseline).
- `updatedAt` triggers exist (`20250904120002_hardening.sql`).
- Non-negative `CHECK`s added for menu/order/payment/refund/coupon/inventory/expense.
- **Status columns are `varchar`, not enums** (e.g. `orders.status`, `staff.status`, `purchase_orders.status`). Only a few have `CHECK` constraints (`staff.status`).
- `createdAt`/`updatedAt` on most tables; `deletedAt` soft-delete is **not used anywhere** (deletes are hard, or `active=false` flags).
- Audit fields: `audit_log` records actor/entity/action/before/after; extended by `auth_hardening` with `ip_address`, `user_agent`, `success`, `metadata`.

### Transactional requirements
- True transactions (`sql.begin`) only in `publicRouter.orders.create` and `outletsRouter.create`.
- **False transactions**: several routers wrap `sql\`BEGIN\`` + `sql.unsafe(...)` + `COMMIT/ROLLBACK`. With the `postgres` pool, `BEGIN` and later queries can run on **different pooled connections**, so there is **no atomicity**. Affected: `couponsRouter.redeem`, `inventoryRouter.items.create/adjust/purchaseOrders.create/receive/preparedItems.batches.produce/transfers.create/transfers.updateStatus/wastage.create`.
- Multi-table writes with no transaction at all: order intake, menu create/update + variant sync, modifier assignment, delivery assignment/status, refunds, support ticket + message, staff create/assign, several inventory recipe writes.

### Frontend expectations vs actual schema
- Frontend expects `admin.menu.list` to return categories/items/variants with availability — matches schema.
- Frontend `CustomersHub` pagination is an `alert()` stub despite cursor APIs existing.
- `InventoryHub` "theoretical quantity" is a placeholder (`Math.floor(quantity / 1)`), not recipe-derived.
- `OutletsHub` setup checklist hardcodes two items `done:false`.

---

## D. Supabase Audit

### Configuration
`supabase/config.toml`: `project_id = starkupps-admin`, PG 17, API/storage/realtime/studio/edge-runtime/analytics enabled. `auth.enabled = true`, `jwt_expiry = 3600`, `enable_signup = true`, `enable_confirmations = false`, `enable_refresh_token_rotation = true`, `site_url = http://127.0.0.1:3000`. `[db.seed]` references `./seed.sql` which **does not exist** (seed directory missing). `[storage] file_size_limit = 50MiB`.

### Migrations (24, in order)
1. `20250904120000_initial_schema.sql` — 71-table baseline (Drizzle PG transliteration).
2. `...0001_product_variants.sql` — variants, variant ingredients, outlet variant availability; order_items snapshot columns.
3. `...0002_hardening.sql` — `updatedAt` triggers, non-negative CHECKs, `cash_movements`, extra indexes.
4. `...0003_rls.sql` — enables RLS on sensitive tables but with permissive `USING (true)`.
5. `...0004_realtime_storage.sql` — Realtime publication + buckets + storage policies.
6. `...0005_staff_pospin.sql` — POS PIN columns (later dropped).
7. `...0006_rls_tighten.sql` — **drops all anon/authenticated policies** (deny-by-default).
8. `...0007_menu_realtime_complete.sql`, `...0010_coming_soon.sql` — Realtime coverage + comingSoon.
9. `...0008_remove_base_price.sql` — backfills default variants, drops `menu_items.price` and `outlet_menu_availability.priceOverride`.
10. `...0009_product_images_storage.sql`, `...0011_category_images_storage.sql` — buckets + policies.
11. `...0012_session_version_and_audit.sql` — `users.sessionVersion`, audit index, staff status CHECK.
12. `...0013_rate_limits.sql` — `rate_limits(key,count,reset_at)`.
13. `...0014_outlet_owner_and_setup.sql` — `outlets.ownerId`, unique `outlet_staff`, unique `outlets.code`.
14. `20260909053000_auth_sessions.sql` — `sessions` table.
15. `20260909053100_password_resets.sql` — `password_resets` table.
16. `20260909053200_auth_session_hardening.sql` — unique session token hash.
17. `20260909060000_auth_hardening.sql` — csrf_tokens, session_limits, audit columns, users status/password_alg, cleanup function.
18. `20260925000000_rls_repair.sql` — scopes auth-table policies `TO service_role`, converges `rate_limits`.
19. `20260925000001_pos_order_persistence.sql` — orders idempotencyKey/tableNo/terminalId.
20. `20260925000002_pos_decommission.sql` — drops POS tables + staff PIN columns.

### RLS
- Enabled on sensitive tables. `anon`/`authenticated` have **no policies on most tables** → deny. App uses `service_role` → bypass. This is a valid "server-authoritative only" posture, **but**:
  - **RLS is NOT enabled on the public catalog tables**: `menu_categories`, `menu_items`, `menu_item_variants`, `modifier_groups`, `modifier_options`, `menu_item_modifiers`, `outlets`, `outlet_hours`, `outlet_menu_availability`, `outlet_variant_availability`. With the anon key (shipped in the storefront bundle) anyone can read/write these via PostgREST, bypassing the gateway. **This is the most severe database finding.**
  - `sessions`, `password_resets`, `rate_limits`, `csrf_tokens`, `session_limits` use `USING (true)` but scoped `TO service_role` (acceptable; service_role bypasses anyway).
- No policy uses `auth.uid()`/identity-based rules (Supabase Auth is not integrated with app tables).

### Storage
- Buckets: `starkupps` (50 MB, public), `product-images` (5 MB, public), `category-images` (5 MB, public), image MIME allowlists.
- Policies: public `SELECT`; `authenticated` `INSERT/UPDATE/DELETE`; `service_role` all. Because storefront **customer signup is enabled**, any self-registered `authenticated` user can upload/overwrite/delete objects in these public buckets. Server-side uploads use `service_role` and do not need the `authenticated` policies.

### Realtime
Publication tables listed in §A. Storefront subscribes via `starkupps-web/src/lib/supabase.ts` (`subscribeMenu`, `subscribeTable`). Admin uses **no Realtime** — it polls (`admin.orders.list` 15 s, `admin.dashboard` 30 s, `delivery.live` 10 s).

### Functions / triggers / edge functions
- Function `public.update_updated_at()` + per-table triggers; `public.is_member_of_outlet()` / `is_active_staff()` (defined in `rls.sql`, currently unused by any policy); `public.cleanup_expired_rate_limits()`.
- **No edge functions** (directory absent).

### Generated types / env / initialization
- `shared/supabase.types.ts` (generated) and `shared/supabase.types` deprecated duplicate `shared/types.supabase.ts`.
- Server client `getSupabaseAdmin()` (service-role, no session persistence). `getSupabaseAnon()` exists but is **never used**.
- Storefront initializes two clients: `getSupabase()` (realtime, anon) and `getAuthClient()` (Supabase Auth, `persistSession:true`).

---

## E. Authentication Audit

### Admin (custom)
- **Provider**: custom, not Supabase Auth. Passwords: Argon2id primary, scrypt legacy fallback (`_core/auth.ts`).
- **Login** (`routers.ts:92`): rate-limited (persistent + in-memory), verifies password, checks `lockedUntil`, transparently migrates scrypt→Argon2id, resolves staff role, **requires `staffRole === "owner"`** for non-`admin` DB users, then issues a 7-day HS256 JWT in httpOnly cookie `app_session_id` and creates a `sessions` row + a `refresh_token` cookie.
- **Session handling**: `index.ts:resolveUserFromRequest` verifies JWT, cross-checks cookie/audience, loads user, enforces `sessionVersion`, and blocks inactive/unlinked staff.
- **Logout**: clears cookies, bumps `sessionVersion`, revokes the session row, emits `Clear-Site-Data`.
- **Reset/change password**: reset tokens (HS256, 1 h) stored hashed in `password_resets`; change bumps `sessionVersion` + revokes all sessions.
- **Refresh**: **not implemented**. A `refresh_token` cookie is set but `validateRefreshToken`/`touchSession` are never called and there is no refresh endpoint. The access JWT simply lives 7 days.
- **Authorization**: `protectedProcedure` = authn only; per-route permission checks vary (see §F). `adminProcedure` is an alias of `protectedProcedure`.

### Storefront (Supabase Auth)
- Separate identity system: `signUp`/`signInWithPassword`/`signOut`/`resetPasswordForEmail`/`updateUser` via GoTrue (`starkupps-web/src/lib/auth.tsx`).
- Session persisted in `localStorage` (`starkupps-web-auth`); SSR always renders logged-out.
- `/account` is guarded **client-side only** (`useEffect` redirect in `account.tsx`); no router `beforeLoad`.
- Customer orders/addresses are cached in browser `localStorage` (`profile.ts`), including PII.

### Bypass possibilities (verified)
1. **Catalog table RLS disabled** → direct anon write/read via PostgREST (highest).
2. **Storefront `authenticated` storage write policies** → any signed-up customer can write/delete bucket objects.
3. **Legacy session tokens without `aud` are accepted** (`_core/trpc.ts:24`, `index.ts:42-43`) — a token minted before the `aud` claim existed passes the POS-audience guard.
4. **Missing outlet authorization** on many mutations (see §F) — a logged-in owner can act on arbitrary outlet-scoped IDs; if non-owner admin access is ever enabled, this becomes cross-tenant IDOR.
5. `publicRouter.orders.byId/byNumber` allow order enumeration with **optional** phone (see §F).

---

## F. Security Audit

### Secrets (no values printed)
| File | Type | Tracked? | In git history? | Action |
|---|---|---|---|---|
| `.env` (root) | Supabase service-role/secret keys, DB URL, access token | No (ignored) | No | rotate if shared |
| `starkupps-admin/.env` | Supabase service-role, DB URL, SESSION_SECRET, AWS keys | No (ignored) | No | rotate if shared |
| `starkupps-web/.env` | anon/publishable keys | No (ignored) | No | anon key is public by design |
| `creds.txt` | plaintext credentials log | No | **YES** (`16647d3`, `6743712`, `ce306fb`) | **rotate; purge history** |
| `starkupps-access-token-key.txt` | Supabase management access token | No | **YES** | **revoke/rotate; purge history** |
| `latestdb-starkupps.sql` | full DB dump (schema+possibly data) | No | **YES** | **treat as data breach; rotate DB creds; purge history** |
| `starkupps-web/.env.example` | live project ref + anon/publishable keys | **Yes** | — | replace with placeholders |
| `starkupps-admin/.env.example` | placeholders only | Yes | — | OK |
| `starkupps-admin/shared/indiaData.json`, `shared/supabase.types.ts` | non-secret | Yes | — | OK |

**Git history exposure is the key issue.** `creds.txt`, `starkupps-access-token-key.txt`, and `latestdb-starkupps.sql` were committed and later removed, but remain in history on `origin`/`upstream` (GitHub). They must be rotated and the history rewritten.

### Code-level vulnerabilities (verified)
| # | Severity | Finding | Location |
|---|---|---|---|
| S1 | Critical | Argon2 password verification is broken | `_core/auth.ts:22` checks `startsWith("argon2$")`, but argon2 emits `$argon2id$…` → verification falls through to scrypt parse and returns false. Seeded/new Argon2 users cannot log in; scrypt users get migrated to a hash they can't later verify. |
| S2 | Critical | Catalog tables have RLS disabled with public anon key | migrations `...0003/0006/0007`; anon can read/write menu + outlets via PostgREST |
| S3 | High | Storage buckets writable by any `authenticated` user (customer signup enabled) | `...0004/0009/0011` storage policies |
| S4 | High | Fake transactions (pool-wide `BEGIN/COMMIT`) cause partial writes | `couponsRouter.redeem`, `inventoryRouter.*`, see §C |
| S5 | High | Client-controlled modifier `priceDelta` trusted when `optionId` omitted | `publicRouter.ts:555-558` |
| S6 | High | Order enumeration + customer phone disclosure; no rate limit | `publicRouter.ts:845/866` |
| S7 | High | Git-history secret exposure (`creds.txt`, access token, DB dump) | git history |
| S8 | Medium | Missing outlet authorization on many mutations | see matrix below |
| S9 | Medium | Public `coupons.validate` / `orders.create` rate limit is per-instance and keyed on spoofable `x-forwarded-for` | `_core/auth.ts:139`, `publicRouter.ts:33` |
| S10 | Medium | POST REST mirrors return 500 for any error | `index.ts:243/255/279` |
| S11 | Medium | `search.query` and several `*.byId` endpoints not outlet-scoped | `operationsRouter.ts:270`, `customersRouter.ts:117`, etc. |
| S12 | Medium | `outlets.byId` public returns `select("*")` | `publicRouter.ts:66` |
| S13 | Medium | Client-declared MIME only; no magic-byte sniffing on uploads | `adminRouter.storage.*` |
| S14 | Low | CSP allows `unsafe-inline`/`unsafe-eval` | `index.ts:144` |
| S15 | Low | `protectedProcedure` accepts legacy no-`aud` tokens | `_core/trpc.ts:24` |
| S16 | Low | Best-effort audit writes can be silently dropped | `db.ts:178-217` |
| S17 | Low | `isHashedPassword` misclassifies Argon2 (same root cause as S1) | `_core/auth.ts:48` |
| S18 | Low | `useAuth` forces `isAuthorized = staffRole === "owner"`, making manager/staff UI unreachable | `client/src/_core/hooks/useAuth.tsx:92` |
| S19 | Low | Customer PII stored unencrypted in browser `localStorage` | `starkupps-web/src/lib/profile.ts` |

### Missing authorization (outlet scope absent) — verified
`admin.orders.byId/updateStatus/cancel`, `admin.bootstrap`, `admin.menu.variants.outletAvailability.*`, `notifications.*`, `search.query`, `outlets.hours.closures.*`, `outlets.zones.list`, `outlets.menuAvailability.list`, `customers.byId`, `customers.feedback.list`, `delivery.riders.setStatus`, `delivery.assignments.updateStatus/cancel`, `finance.refunds.*`, `finance.expenses.remove`, `finance.taxes.*`, `finance.payouts.list`, `inventory.items.create/update/setActiveMany`, `inventory.adjust`, `inventory.purchaseOrders.*`, `inventory.transactions`, `inventory.recipes.byId/update/remove`, `inventory.preparedItems.batches.produce`, `staff.update/changeRole/setStatus/setActive`, `staff.attendance.clockOut/breakToggle/correct`, `staff.shiftTemplates.update/remove`, `staff.schedules.remove`, `staff.leave.review`, `support.addMessage`, `coupons.setStatus/remove/validate`, `coupons.redemptions.updateStatus`, `coupons.analytics`.

> Mitigation: admin login is currently owner-only, so most of these require an authenticated owner. The risk is latent privilege escalation / future multi-tenant IDOR, and it is a genuine defect against the stated role model.

### Positive controls already present
- Service-role key is **never** exposed to either browser bundle (verified: no `createClient(service_role)` in clients; `starkupps-web/.env` only ships anon/publishable).
- Parameterized SQL throughout; no user-string SQL interpolation found.
- CORS explicit allowlist + `credentials:true`; cross-origin requests with untrusted `Origin` rejected; CSRF guard for cookie mutations.
- Login/reset rate limited persistently; generic auth errors; anti-enumeration reset; `sanitizeReturnTo`; security headers; `Clear-Site-Data` on logout.
- Password hashing is Argon2id (once S1 is fixed), with scrypt migration.

---

## G. Mock Data Audit

The storefront menu mock has been removed (`starkupps-web/src/lib/menu.ts` is an empty deprecated stub). Remaining production-facing mock/placeholder data:

| # | Location | Type | Should be replaced by |
|---|---|---|---|
| M1 | `staffWorkforceRouter.ts:461-513` | Hardcoded fallback roles/permissions/matrix when workforce tables empty | Seeded `workforce_*` rows (migration) |
| M2 | `customersRouter.ts:278-327` | Hardcoded customer segments with negative IDs | Seeded `customer_segments` rows |
| M3 | `publicRouter.ts:640-651` | Hardcoded packing/delivery charges, taxes=0 | `store_settings`/outlet charges + `taxes` table |
| M4 | `InventoryHub.tsx:290-303` | Placeholder theoretical quantity `floor(qty/1)` | `recipe_components`/`menu_variant_ingredients` join |
| M5 | `InventoryHub.tsx:208-211` | Static "Recent Inventory Activity" | `inventory.transactions` query |
| M6 | `FinanceHub.tsx:82` | Fabricated `providerRefundId: prov_${Date.now()}` | Real provider ref or omit |
| M7 | `OutletsHub.tsx:322-332` | Checklist items hardcoded `done:false` | Derived from `outlet_hours`/`payments` |
| M8 | `StaffHub.tsx:108` | "On Break" always `—` | `attendance_records` |
| M9 | `staffWorkforceRouter.ts` role matrix + `customersRouter` VIP threshold 5000/coupons 5-order VIP | Hardcoded business rules | Config/`loyalty_rules`/settings |
| M10 | `ComponentShowcase.tsx`, `DashboardLayout.tsx` (unrouted) | Demo AI chat with `setTimeout`, "Page 1/Page 2" | Delete dead code |
| M11 | `starkupps-web` homepage/trust/gallery/location | Hardcoded marketing/business copy (KPIs, FSSAI, phone, reviews) | CMS tables (`content_blocks`, `testimonials`, `faqs`) — currently only partially wired |
| M12 | `adminRouter.ts:300/665` | Unsplash placeholder images | Storage/CMS |
| M13 | `AdminApp.tsx:733-910` | Simulated upload progress via `Math.random()` | Real progress events or indeterminate |
| M14 | `financeRouter.ts:147-176,239-248` | Synthesizes transactions / payment stubs | Real `payments` rows |
| M15 | `_core/mailer.ts` | "not production ready" — logs reset link if `DEBUG_AUTH_TOKENS=1` | SMTP/Resend provider |
| M16 | `storage.ts:104-106` | Local stub URL fallback | Require configured bucket |

Hardcoded **configuration defaults** (outlet code `SK-XXXX`, 09:00–22:00 hours, `Asia/Kolkata`, packing ₹15/delivery ₹29, order `source:"website"`) are defaults rather than fake records; they should move to configurable settings but do not fabricate data.

---

## H. Realtime Audit

### Currently subscribed (storefront only)
- **Menu sync**: `menu_categories, menu_items, menu_item_variants, modifier_groups, modifier_options, menu_item_modifiers` (+ `outlet_menu_availability`, `outlet_variant_availability` filtered by outlet). Coalesced 120 ms → invalidates the menu query. Correct pattern (event → targeted cache invalidation), though invalidation-only (no direct cache patch).
- **Outlets**: `outlets` table → invalidates outlets query.

### Should update live but currently poll or are stale
| Workflow | Current | Recommended |
|---|---|---|
| Admin order queue | poll 15 s | Realtime `orders` INSERT/UPDATE → patch list cache, or keep poll for owner-only |
| Admin dashboard KPIs | poll 30 s | Realtime `orders`/`payments` invalidation (debounced) |
| Delivery live | poll 10 s | Realtime `deliveries` (+ `riders`) → patch |
| Customer order status | manual "Track" via tRPC | Realtime `orders` UPDATE filtered by order id |
| Inventory low-stock/alerts | manual refetch | Realtime `inventory_items`/`inventory_batches` (debounced) |
| Notifications | staleTime 30 s | Realtime `notifications` by recipient |
| Menu (admin→web) | Realtime + query | keep |
| Coupons/inventory/promo on web | not needed | keep off realtime |

### Design cautions
- Admin client cannot subscribe directly today without either (a) RLS `SELECT` policies for the anon key on operational tables (not acceptable — leaks data) or (b) brokering Realtime via the server (Supabase Realtime `broadcast`/`presence` from the gateway) or (c) integrating Supabase Auth for admin. The storefront's table-based subscription is viable only because catalog data is intended public.
- Avoid subscribing to every table; prefer targeted `postgres_changes` with `filter` on `outletId`/`id`, update cache directly, and debounce.

---

## I. Performance Audit

- **N+1 queries**: `outletsRouter.list` runs several per-outlet enrichment queries inside `Promise.all` (counts + revenue); `admin.menu.list` enriches variants/modifiers per item; `customers.list` derives from orders per customer; `financeRouter.revenue` loads up to 5000 orders and aggregates in JS.
- **Repeated fetches**: web mounts three `usePublicMenu` consumers → three Realtime channels + deduped query. Admin modules refetch whole lists on every mutation (invalidation), and polling adds constant load.
- **Payload size**: `publicRouter.outlets.byId`, `menu.categories`, `menu.byId` return `select("*")` including internal columns (`sku`, `quantity`).
- **Missing indexes** (candidate): `orders(customerId)`, `orders(status)`, `order_items(orderId)` (FK has none?), `coupon_redemptions(couponId,customerId,status)`, `audit_log(entityType,action)`, `customers(phone)` (unique?), `deliveries(orderId)`, `menu_items(categoryId)`. Some exist via `hardening`/`auth_hardening`.
- **Caching**: TanStack Query staleTimes are small (menu 10 s, outlets 15 s); admin uses default `staleTime:0` + polling.
- **Rerenders**: large module components (`AdminApp.tsx` ~1150 lines, `InventoryHub.tsx`, `StaffHub.tsx`) hold many queries/mutations in one component.
- **Note**: no measurement/APM is present; findings above are static-analysis based.

---

## Summary of critical findings to fix first

1. **S1** Argon2 verification bug — blocks/breaks all admin logins.
2. **S2** RLS disabled on catalog tables — public anon read/write via PostgREST.
3. **S3** Storage buckets writable by any `authenticated` user.
4. **S7** Secrets committed to git history — rotate + purge.
5. **S5/S6** Public order pricing trust + order enumeration.
6. **S4** Non-atomic "transactions".
7. **S8/S11** Missing outlet authorization across many procedures.
8. **G** Production-facing mock/placeholder data (M1–M14).
9. **S18** Manager/staff admin capability matrix unreachable.
10. **E** Refresh-token rotation advertised but unimplemented; sessions table write-only.

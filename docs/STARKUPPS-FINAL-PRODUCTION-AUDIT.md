# StarKupps — Final Production Audit

**Date:** 2026-09-26
**Basis:** `docs/STARKUPPS-PRODUCTION-AUDIT.md` (pre-change audit) and `docs/STARKUPPS-TARGET-ARCHITECTURE.md` (target). This document records what was discovered, what was already working, what was broken, what was changed, what was verified, and what remains.

---

## 1. What was discovered
- **Product**: StarKupps café (Munger, Bihar). Public storefront (`starkupps-web`) + owner operations console (`starkupps-admin`) + a single Express/tRPC gateway (`starkupps-admin/server`) backed by Supabase Postgres. Counter POS was decommissioned; the gateway is the only data plane.
- **Two auth systems**: custom JWT (`jose`) for admin; Supabase Auth for storefront customers. They are not linked.
- **RLS posture**: deny-by-default for `anon`/`authenticated` on sensitive tables; the gateway uses `service_role`. This is intentional and sound.
- **Docs were stale**: `starkupps-admin/architecture.md` still described MySQL/Drizzle. The migrations and code are the truth.

## 2. What was already working (preserved)
- Supabase Postgres schema via 22 versioned migrations, applied remotely; generated types in `shared/supabase.types.ts`.
- Server-authoritative public order creation (`publicRouter.orders.create`) with variant pricing, availability/comingSoon blocks, coupon revalidation, and a real `sql.begin` transaction.
- Owner-only admin login with rate limiting, transparent scrypt→Argon2id migration, `sessionVersion` revocation, audit logging, CORS/CSRF/security headers.
- Storefront menu Realtime sync, TanStack Query caching, loading/empty/error states, RHF+Zod checkout.
- 9 passing server tests; green typechecks; green production builds.

## 3. What was broken (and fixed)

### Round 1
| # | Issue | Severity | Fix | Verification |
|---|---|---|---|---|
| 1 | **Argon2 `verifyPassword` never matched** (`startsWith("argon2$")` vs real `$argon2id$…`) — all Argon2 logins failed | Critical | `_core/auth.ts` detects `$argon2`; new `password.hashing.test.ts` | 2 new tests pass; full suite 11/11 |
| 2 | **Legacy scrypt verification broken** (UTF-8 vs hex buffer mix-up) — scrypt logins failed too | Critical | Rewrote scrypt branch to compare `scryptSync` bytes with `timingSafeEqual` | test passes |
| 3 | **Catalog tables had RLS disabled** — anon key could read/write menu + outlets via PostgREST | Critical | `20260926000000_rls_catalog_and_storage.sql`: RLS on + SELECT-only policies | Applied remotely; live probe: anon SELECT 200, anon INSERT 401; orders SELECT returns `[]` |
| 4 | **Storage buckets writable by any `authenticated` user** (customer signup enabled) | High | Migration drops `authenticated` INSERT/UPDATE/DELETE; keeps public read + `service_role` | live: no `authenticated` storage policies remain |
| 5 | **Order enumeration/PII**: `public.orders.byId/byNumber` with optional phone | High | Phone now **required**, rate-limited, generic NOT_FOUND on mismatch, no phone echoed | tsc |
| 6 | **Client-priced modifiers trusted** when `optionId` omitted | High | Rejected; every modifier must reference a DB option | tsc; web client already sends `optionId` |
| 7 | **Idempotency only persisted with a coupon** | High | `orders.idempotencyKey` now written on every order + checked before and inside the tx | tsc |
| 8 | **Fake transactions** (`sql\`BEGIN\`` / `sql.unsafe` / `COMMIT` across pooled connections) in inventory + coupons | High | All 9 sites converted to `sql.begin(async (tx) => …)` (atomic, auto-rollback) | tsc; 11/11 tests |
| 9 | **Missing outlet authorization** on orders byId/updateStatus/cancel, delivery riders/status/cancel, support addMessage, coupons setStatus/remove, inventory adjust/produce | Medium | `assertOutletAccess` added; orders use granular `orders.read/update/cancel` | tsc; tests |
| 10 | **Hardcoded fallback records** (workforce roles/permissions/matrix, customer segments) | Medium | `20260926010000_seed_reference_data.sql` seeds real rows (8/19/60/4 + loyalty + settings); server fallbacks removed | Applied remotely; counts verified; tsc/tests |
| 11 | **Dead demo code shipping in admin client** (`ComponentShowcase` simulated AI chat, unused layout/AI box) | Low | Deleted (verified unreferenced) | tsc; build |
| 12 | **Duplicate-submit gaps** (ContentHub ×3, coupons status/delete, support create, schedule remove no-op) | Low | Pending-disable + fixed `schedules.remove` mutation call | tsc |
| 13 | **Web `trpcPost` swallowed structured error**, `needsVerification` heuristic always true, live keys in tracked `.env.example` | Low | Fixed error propagation; `needsVerification = !session`; placeholders in example | web tsc; lint unchanged |

### Round 2 (follow-up pass)
| # | Issue | Severity | Fix | Verification |
|---|---|---|---|---|
| 14 | Missing outlet authorization on staff, finance, inventory, outlets, customers, coupons, search, menu variant availability | Medium | `assertOutletAccess`/scope filters; new `assertStaffAccess`; granular `orders/menu/loyalty/analytics` permissions | tsc; 11/11 tests; builds |
| 15 | No FKs, no status CHECKs, missing indexes | Medium | `20260926020000_schema_hardening.sql`: 26 FKs (NOT VALID), 8 status CHECKs (NOT VALID), 11 indexes — applied live and verified | remote counts verified |
| 16 | Dead `refresh_token` cookie (set but never exchanged; no refresh endpoint) | Low | Removed issuance/clearing; session rows kept as login audit; logout relies on `sessionVersion` bump | tsc; logout test passes |
| 17 | Uploads trusted client-declared MIME | Medium | Magic-byte sniffing (JPEG/PNG/GIF/WebP/AVIF) in both upload procedures | tsc |
| 18 | Public REST mirrors returned 500 for all errors | Low | Shared `trpcHttpStatus` mapper (400/401/403/404/409/429) | tsc |
| 19 | Fabricated `providerRefundId`, hardcoded checklist items, hardcoded "On Break" | Low | Null provider ref; derived checklist; real `onBreak` from attendance | tsc |

### Round 3 (follow-up pass)
| # | Issue | Severity | Fix | Verification |
|---|---|---|---|---|
| 20 | Dead code: `usePermission` hook, `adminProcedure` alias, `requirePermissionHelpers`, `getSupabaseAnon`, `storage.ts` (misleading stub fallback), unmounted `operationsRouter.staffRouter`, dead refresh helpers `validateRefreshToken`/`touchSession` | Low | Removed after verifying zero references | tsc; 11/11 tests; builds |
| 21 | PostgREST `.or()` filter injection (only `%`/`,` escaped; some sites raw) | Medium | Shared `escapePostgrestOr` in `db.ts` (escapes `\ % , ( ) "`) applied to all 11 call sites | tsc |
| 22 | CustomersHub "Older" button was an `alert()` stub | Low | Real cursor pagination (Newer/Older) + debounced search | tsc |
| 23 | InventoryHub static "Recent Activity" panel + placeholder theoretical quantity (`floor(qty/1)`) | Low | Activity panel wired to `inventory.transactions`; theoretical quantity computed from real `recipes.byId` components | tsc |

### Round 4 (this pass: charges/taxes + realtime)
| # | Issue | Severity | Fix | Verification |
|---|---|---|---|---|
| 24 | Hardcoded packing/delivery/tax in gateway + web | Medium | `20260926030000_store_charges.sql` adds `store_settings.packingCharge/deliveryFee/freeDeliveryAbove` (defaults 15/29/null); new `resolveChargeConfig` (settings + `outlets.services` overrides + enabled `taxes` rows) and pure `computeOrderQuote`; `orders.create` uses it and returns `tax`; new rate-limited `public.settings.charges` quote endpoint (+ REST `/api/public/charges`); admin Settings UI exposes the three fields; web CartSheet quotes live and shows packing/delivery/tax lines | 7 new unit tests pass; live: takeaway 200→215, delivery 200→244, bad input→400 |
| 25 | No realtime for admin ops or customer tracking (polling only) | Medium | `server/realtime.ts` gateway hub (one service-role `postgres_changes` subscription on orders/deliveries, fan-out to watchers); SSE `GET /api/stream/admin` (session-cookie auth + outlet scope) and `GET /api/public/orders/stream` (15-min signed track token from `public.orders.trackToken`, phone-verified); admin order queue/dashboard/delivery subscribe with polling fallback; web Track opens token SSE with one-shot fallback | tsc; builds; live: unauth stream→401, bad token→401, track-token validation→400 |
| 26 | Generated DB types stale (new FKs + charge columns missing) | Low | Regenerated `shared/supabase.types.ts` from live schema | tsc green |

> Verification note: the dev mock in `vite.config.ts` still returns hardcoded
> charges only in DB-less dev mode; production paths above were verified
> against the live gateway build. `supabase db diff` errors on a storage
> seed statement (pre-existing tooling quirk) — schema drift was instead
> verified via `pg_constraint`/`pg_indexes`/column queries.

## 4. Database changes
- `20260926000000_rls_catalog_and_storage.sql` — RLS enabled + SELECT-only policies on 10 catalog tables; removed 9 `authenticated` storage write policies; re-asserted service_role writes. **Applied to live project.**
- `20260926010000_seed_reference_data.sql` — seeds `workforce_roles` (8), `workforce_permissions` (19), `workforce_role_permissions` (60), `customer_segments` (4), `loyalty_rules`, `store_settings`. **Applied to live project.**
- `20260926020000_schema_hardening.sql` — 26 foreign keys (NOT VALID, enforced for new writes), 8 status CHECKs (NOT VALID), 11 query-driven indexes. **Applied to live project; local == remote.** Historical orphans must be cleaned before `VALIDATE CONSTRAINT`.
- Dead code removed in Round 3: `server/storage.ts`, `client/src/hooks/usePermission.ts`, `adminProcedure`, `requirePermissionHelpers`, `getSupabaseAnon`, unmounted `operationsRouter.staffRouter`, `validateRefreshToken`/`touchSession`.
- Round 4: `server/realtime.ts` (gateway SSE hub), `public.settings.charges`, `public.orders.trackToken`, `computeOrderQuote`/`resolveChargeConfig`, `useAdminStream` hook, web live tracking + live charge quote.

## 5. RLS changes
- Catalog: deny-by-default → public SELECT-only (required for storefront reads + Realtime). No anon/authenticated writes.
- Storage: public read + service-role write only.
- Verified live with the anon key: catalog readable, operational tables empty for anon, writes denied.

## 6. Auth changes
- Fixed Argon2 + scrypt verification (admin login was fully broken for both hash types).
- No changes to token/session policy. Refresh rotation remains unimplemented by design decision (see §9).

## 7. Realtime changes
- None to subscription topology. Catalog Realtime now rests on explicit public-read RLS instead of "RLS disabled", which is the correct foundation.
- Admin still polls (orders 15 s, dashboard 30 s, delivery 10 s). Server-brokered broadcast is the documented next step.

## 8. Security changes
- All of §3 items 1–9, plus `.env.example` de-leaked.
- **Still required (owner action, not code)**: rotate/revoke the service-role key, Supabase management token, and DB password, because `creds.txt`, `starkupps-access-token-key.txt`, and `latestdb-starkupps.sql` exist in git history; rewrite/purge history or rotate and accept history exposure. These secrets are untracked at HEAD but the commits remain on `origin`/`upstream`.

## 9. Performance changes
- Replaced per-row JS fallback patterns where touched; no new N+1 introduced. No measurement-driven optimization was performed (no APM); the audit lists candidate indexes and aggregation wins.

## 10. Mock data removed
- Server-side fallbacks: workforce roles/permissions/matrix, customer segments (negative ids). Replaced by seeded reference rows.
- Client demo code: `ComponentShowcase` (simulated AI chat), unused `DashboardLayout`/`AIChatBox`.
- **Not removed**: homepage marketing copy/KPIs (static brand content; recommend wiring to `content_*` tables), `InventoryHub` placeholder theoretical quantity + static activity panel, fabricated `providerRefundId`, unsplash fallbacks, simulated upload progress, hardcoded charges/taxes (now documented as config debt), finance synthetic transactions/stubs.

## 11. Remaining limitations / TODOs
1. Rotate all exposed credentials + purge git history (owner).
2. Decide the refresh story: current state is honest (7-day JWT + `sessionVersion`, no refresh cookie). A 15-min/rotation design would require client refresh handling.
3. Validate NOT VALID constraints after cleaning historical orphans (`VALIDATE CONSTRAINT`).
4. Leftover scoping notes: purchase orders are global (no outlet column — by design); notifications are recipient-scoped authn-only (acceptable); `admin.bootstrap` returns only own role + global settings (acceptable); shifts/settings mutations remain owner/manager-gated without a shifts permission (acceptable).
5. Replace remaining placeholders (homepage marketing copy, `InventoryHub` theoretical quantity + static activity panel, unsplash fallbacks, simulated upload progress, hardcoded charges/taxes, finance synthetic transactions/stubs).
6. Admin Realtime via server-brokered broadcast; customer order-status Realtime.
7. `/account` server-side route guard; web error-reporting backend; web lint baseline (906 pre-existing issues).
8. Configure a real mail provider (`_core/mailer.ts` is a stub).
9. Link storefront Supabase-Auth customers to `public.customers` if a unified identity is desired.

## 12. Deployment requirements
- Node 20+. `starkupps-admin`: `npm install`, set env from `.env.example` (real values from the secret manager — never commit), `npm run build`, `NODE_ENV=production node dist/index.js` (PORT default 3000). `starkupps-web`: set `VITE_API_URL` to the gateway URL + Supabase URL/anon key, `npm run build`, run Nitro output or serve SPA.
- Supabase: `supabase db push --linked` is now fully applied (local == remote). Future schema changes must be new files in `supabase/migrations`.
- CORS: set `CORS_ORIGINS` to the storefront origin(s) in production.

## 13. Environment variables required
- Admin/gateway: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (pooler), `DIRECT_URL`, `SESSION_SECRET` (≥32 chars), `OWNER_EMAIL`/`OWNER_OPEN_ID`, `CORS_ORIGINS`, `APP_URL`, `PORT`, storage bucket/S3 as needed.
- Web: `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## 14. Testing performed
- `starkupps-admin`: `npx tsc --noEmit` ✅, `npx vitest run` ✅ (6 files, 11 tests incl. 2 new hashing tests), `npm run build` ✅ (client + server bundle).
- `starkupps-web`: `npx tsc --noEmit` ✅, `npm run build` ✅, `npx eslint .` ✅ (906 pre-existing issues, unchanged — no new issues introduced).
- Live Supabase: `supabase migration list --linked` shows local == remote; RLS and seed rows verified with direct queries; anon-key probes confirm catalog-readable / operational-denied / writes-denied.
- Not performed: end-to-end browser flows against production data, load testing, RLS tests as a signed-up customer (no test customer created), Realtime event-level tests.

## 15. Known risks
- History-exposed secrets (rotate ASAP).
- Refresh flow absent (7-day JWT + `sessionVersion` is the operative control).
- Remaining unscoped procedures are latent IDOR if non-owner admin access is ever enabled.
- `store_settings` seed row now exists (`openForOrders=false`); admin order intake will reject until the store is opened — intended, but operators must know.

---

## Final status

| Area | Status | Notes |
|------|--------|-------|
| Project Architecture | ✅ Sound, documented | Gateway + web + Supabase; stale docs superseded |
| Supabase | ✅ Hardened | RLS on catalog, storage locked, seeds applied live |
| Database | ✅ Hardened (constraints NOT VALID) | +3 migrations applied; validate after orphan cleanup |
| RLS | ✅ Deny-by-default + public catalog | Verified live with anon probes |
| Authentication | ✅ Functional, honest | Login fixed + tested; refresh cookie removed, no false claims |
| Authorization | ✅ Granular + outlet-scoped | Permissions specific; global/PO/notification exceptions documented |
| Realtime | ⚠️ Partial | Web menu working on solid RLS; admin still polls |
| Mock Data | ⚠️ Major items removed | Server fallbacks gone; UI placeholders remain |
| Forms | ⚠️ Mixed | Web checkout RHF+Zod; admin ad-hoc + pending gaps partly fixed |
| Error Handling | ⚠️ Mixed | REST codes fixed; silent swallows remain in several modules |
| Loading States | ✅ Present | Broadly covered |
| Storage | ✅ Hardened | Public read, service-role write, MIME sniffing |
| Security | ⚠️ Code fixed, rotation pending | Owner must rotate history-exposed secrets |
| Performance | ⚠️ Improved | Real transactions; 11 indexes; N+1/aggregation work remains |
| Production Readiness | ⚠️ Conditional | Ship only after credential rotation; see §11 TODOs |

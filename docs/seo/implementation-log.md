# SEO Implementation Log (branch `seo/geo-overhaul`)

Running log of every SEO change: what, why, evidence, rollback. Latest first.

---

## 2026-10-10 — CI guardrails + risk register (this commit)

- `scripts/assert-seo.mjs` (postbuild last): one title/H1, canonical-vs-path
  match, no stray noindex, JSON-LD present, img alt, anchor, sitemap/robots
  checks. Negative-tested against broken builds (missing H1/canonical,
  off-origin sitemap all fail); offline builds warn-and-pass by design.
- `PageMeta` auto-noindex off the canonical host (staging/preview safety,
  loopback exempt for lab). Caught live by LHCI itself (SEO 0.66 on localhost
  → fixed → 100).
- `lighthouserc.cjs` + `.github/workflows/seo.yml` (web verify, admin
  test/typecheck, LHCI on 5 URLs). Proven green locally end-to-end.
- CLS hunt closed: menu-page footer travel fixed via reserved intro footprint
  (slug-derived H1 + skeleton) and section min-height — CLS 0.22→0 on menu
  pages, including with a failing API. Menu-page lab CLS now ≤0.036.
- `docs/seo/risk-register.md`: regressions, assumptions, UNVERIFIED list.

## 2026-10-10 — Perf/a11y pass + menu Outlet fix (commit `9281bdf`)

**Routing fix:** `/menu/*` rendered the hub (missing Outlet parent) — category canonicals
mismatched, pizza SEO 92. Fixed with `menu.route.tsx`; re-verified SEO 100.

**Perf:** self-hosted fonts (no Google chain), AVIF ladder (~70% smaller),
cart/auth/below-fold lazy, motion out of boot, relative-URL hero preload.

Lab (Moto G4 emulated, localhost preview) vs real (unthrottled puppeteer):

| Page | Perf | SEO | A11y | BP | LCP lab | CLS | LCP real |
|---|---|---|---|---|---|---|---|
| `/` | 82 | 100 | 100 | 96* | 4.3s | 0 | ~200ms |
| `/menu` | 84 | 100 | 100 | 96* | 4.0s | 0 | — |
| `/menu/pizza` | 84 | 100 | 100 | 96* | 3.8s | 0 | — |
| `/contact` | 83 | 100 | 100 | 96* | 4.1s | 0 | — |
| `/faq` | 86 | 100 | 100 | 96* | 3.8s | 0 | — |

\* BP 96 = localhost CORS console errors only (gateway allowlists production
origins); not a production defect. TBT 118→50ms. Emulated LCP is a headless
software-rasterization artifact (identical run with JS disabled; real devices
have GPUs) — CrUX field data post-launch is the true check, then decide on
further JS diet (react/supabase/tanstack are irreducible without a framework
change; motion removal from MenuSection/FaqSection would rewrite animations).

**A11y fixes (measured before/after in-browser):** primary `#C9622F`→`#A95025`
(text 4.03→4.95, buttons 3.98→5.13); gallery eyebrow to foreground label;
FetchErrorState h3→h2. DoD a11y/SEO ≥95 met on all pages in lab.

## 2026-10-10 — Phase 3: page set + hub linking (commits `639c5b3`, `3c6dd78`)

**What:** `/menu` hub, `/menu/$slug` ×6, `/contact`, `/faq` (+Breadcrumbs,
category-summary, footer nav, header Contact, FaqSection contactHref). Prerender
emits all 11 pages; sitemap merges the dynamic-slug manifest (11 URLs); validator
recursive; FAQPage schema consolidated on `/faq`.

**Why:** crawlable topical hubs (menu ↔ categories ↔ contact/FAQ), answer-first
intros from live data, question-H2 contact page for AI-assistant queries.

**Verified:** web `verify` green; validator green on all pages; ClaudeBot UA → 200
+ H1 on /menu (43 KB full menu), /contact, /faq, /menu/pizza, /menu/cold-coffee;
unknown slugs → noindex 404 screen. Rollback: revert both SHAs.

**Still planned (not started):** perf rework (self-host/subset fonts, AVIF, real
Lighthouse run — no Chrome in this env), analytics events (needs owner provider
choice), full CI guardrails beyond JSON-LD, `llms.txt` (deferred last by design).

## 2026-10-10 — Phase 4 + owner docs (commits `27e97c0`, docs batch)

- `robots.txt`: explicit Allow for OAI-SearchBot/ChatGPT-User/Claude-SearchBot/
  Claude-User/PerplexityBot(+User); training crawlers default ALLOW with a
  documented one-line flip (owner decision recorded: allow); defensive Disallow
  for `/api/`, `/auth/`, preview/debug params; staging-noindex as owner hosting
  action. No repo layer blocks search/citation bots (verified: no CDN/WAF/bot
  rules in `vercel.json` or code; all 7 bot UAs got 200 pre-change).
- `docs/seo/owner-actions.md` (P0–P3 ordered checklist + curl verification),
  `social-seo-playbook.md` (identity block, per-platform, calendar, checklist),
  `ai-visibility-tracking.md` (30-prompt set, log table, targets; baseline 0%).
- Deferred honestly: `llms.txt` (no measured benefit; revisit last), Hindi pages
  (single `en` + natural Hinglish until GSC data), `/menu` + category + contact
  pages (Phase 3 build), perf rework + real Lighthouse run (no Chrome in this
  env), analytics events + full CI guardrails beyond JSON-LD (Phase 7).

## 2026-10-10 — Phase 2: JSON-LD + validator + entity sheet (commit `eb1e131`)

## 2026-10-10 — Freshness hook, admin side (commit `54e9164`)

**What:** `starkupps-admin/server/lib/seo-rebuild.ts` + one middleware on
`protectedProcedure` (`server/lib/trpc.ts`) + `SEO_REBUILD_HOOK_URL` env
(`server/config/env.ts`, `.env.example`) + 22 unit tests.

**Why:** prerendered HTML is only as fresh as the last build. After any
storefront-visible mutation the gateway now POSTs the Vercel Deploy Hook
(debounced 60 s trailing-edge, fail-open, no-op when unset).

**Trade-offs:** middleware allowlist at the single `protectedProcedure` choke point
instead of ~37 individual call sites (auditable, covers future mutations in the same
routers; a NEW storefront-visible router must add its prefix + test row). Order,
inventory, auth, zones, content-blocks writes never match. Hook failures only warn.

**Verified:** eslint + `tsc --noEmit` clean; new suite 22/22; **full admin suite
369/369 green (27 files)**. Owner still must: create the Deploy Hook in Vercel, set
`SEO_REBUILD_HOOK_URL` in Cloud Run env, add nightly rebuild.

**Rollback:** `git revert 54e9164`.

## 2026-10-10 — Pre-existing break found: admin `npm ci` (commit `92f1efd`)

`starkupps-admin/package-lock.json` was missing `@testing-library/*` entries, so
`npm ci` (and therefore `Dockerfile:10` production builds) failed on a fresh checkout
(`EUSAGE ... not in sync`). Regenerated via `npm install` — lockfile only, no
dependency changes. Needed to verify the admin-side hook; also un-breaks admin deploys.

## 2026-10-10 — Phase 1c: build-time prerender (commit `2be61f7`)

**What:** `starkupps-web/scripts/prerender.mjs` (stdlib-only), wired as first half of
`postbuild`. Fetches live `/api/public/site|menu|faqs` and injects complete semantic HTML
into `dist/index.html` (`/`) and `dist/about.html`.

**Why:** CSR-only shell (2086 B, zero content) was invisible to all non-JS crawlers
(GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot) — discovery §2 CRITICAL #1.

**Trade-offs (written, per mission rule 7):**
- *Chosen (B) build-time prerender* over (A) SSR migration (TanStack Start not installed;
  would change framework, hosting, and realtime auth flows — weeks of risk) and over
  (C) bot-only edge layer (cloaking-adjacent; same content must serve everyone).
- React (`createRoot`, not `hydrateRoot`) replaces prerendered markup on boot — one
  paint flash possible; acceptable, documented. No new dependency added.
- About-page static paragraphs are mirrored verbatim from `about.tsx`; mirror obligation
  is documented in the script header and will be CI-enforced in Phase 7.

**Verified (local preview, 2026-10-10):**
- `curl -A PerplexityBot /` → `<h1>Cold coffee that ruins other cold coffee.</h1>` ✅
- `/about` → 200, H1 present ✅ (production Vercel 404 fixed as a side effect:
  `about.html` now exists as a real file under `cleanUrls`)
- `/sitemap.xml` → 200 ✅; app JS bundle ref intact in prerendered HTML ✅
- `npm run verify` green (lint + typecheck + tests + build) ✅
- Prices rendered from live data (₹45–₹99 across categories; 38 items, 6 categories,
  15 FAQs); `og:image` = absolute built hero photo URL.

**Freshness design (window = time between deploys; target < 24 h after hook lands):**
- HTML is as fresh as the last Vercel build. Triggers, in order: (1) admin "publish"
  Deploy Hook (TODO — see below), (2) nightly scheduled rebuild (owner: Vercel cron or
  GitHub Action; no `.github/` exists yet), (3) manual redeploy. IndexNow submission runs
  inside the build when `INDEXNOW_KEY` is set (owner action: generate once, e.g.
  `openssl rand -hex 16`, set in Vercel env).
- TODO (admin side): POST `SEO_REBUILD_HOOK_URL` (Vercel Deploy Hook, secret — Vercel
  dashboard + admin env only) after site-content/menu publishes. Fire-and-forget,
  fail-open, idempotent (Vercel dedupes rapid hook calls into one build).

**Rollback:** `git revert 2be61f7` — `dist/` is gitignored; worst case the site serves
today's shell. No runtime code paths changed.

## 2026-10-10 — Sitemap + robots (commits `780a628`, `7409e3c`)

`scripts/generate-sitemap.mjs` (second half of `postbuild`): lists exactly the routes
whose `PageMeta` declares `path=` without `noIndex` (today: `/`, `/about`); origin
cross-checked against `CANONICAL_ORIGIN`, build fails on drift. `robots.txt` gains
`Sitemap: https://www.starkupps.in/sitemap.xml`. Verified in build output.

## 2026-10-10 — Canonical foundation (commit `291039d`)

- `CANONICAL_ORIGIN = "https://www.starkupps.in"` (owner-confirmed same day) in
  `src/config/site.ts`; `canonicalUrl()` helper for reuse by sitemap/prerender/JSON-LD.
- `PageMeta path=` prop → self-referencing canonical; wired on `/`, `/about`,
  `/login`, `/signup`; static canonical in `index.html` baseline.
- `/login`, `/signup` → `noindex,nofollow` (were indexable).
- `vercel.json`: 308 host redirects for the three non-canonical origins.
- Optional `VITE_GSC_VERIFICATION` / `VITE_BING_VERIFICATION` meta tags (unset = absent).
- `npm run verify` green before commit.

## 2026-10-10 — Phase 0 (commit `291039d`, same commit)

`docs/seo/00-discovery.md`: full audit. Key corrections to the mission brief: no
rider/pos/superadmin apps (admin is `starkupps-admin` on Cloud Run); no GSC verification
artifact in repo; Snapchat/Facebook URLs 404; live menu has 6 categories incl. Shakes;
docs/ audits are stale (claim TanStack Start SSR — site is CSR-only).

---

## BEFORE / AFTER (running table; lab Lighthouse still TODO — no Chrome in env)

| Check | Before (2026-10-10 AM) | After (2026-10-10 PM, local build) |
|---|---|---|
| `curl` no-JS `/` (any bot UA) | 2086 B shell, no H1/content | ~20 KB: H1, 38 items + prices, NAP, hours, 15 FAQs, canonical, OG+image |
| `curl` no-JS `/about` | live **404** | 200, H1 + story + FSSAI + hours + directions |
| Canonical tags | none | self-referencing on all public routes; static in shell |
| Host duplication | 4 origins × identical 200 | redirects committed (verify post-deploy) |
| `sitemap.xml` / robots `Sitemap:` | 404 / absent | generated (2 URLs) / present |
| JSON-LD | none | none (Phase 2) |
| GSC/Bing verification | none in repo | placeholders ready, tokens needed (owner) |
| Lighthouse SEO/A11y, LCP/INP/CLS | unmeasured (no Chrome) | unmeasured — first run TODO |
| Login/signup indexation | indexable | noindex |
| Secrets hygiene | `.env.production` tracked | unchanged — owner must set Vercel env vars first, then `git rm --cached` |

## Open owner items (mirror of discovery §11 — strike through as done)

- [x] Canonical host → `https://www.starkupps.in` (+ proceed with Phase 1)
- [ ] GSC/Bing verification tokens → `VITE_GSC_VERIFICATION` / `VITE_BING_VERIFICATION`
- [ ] `INDEXNOW_KEY` (generate once, Vercel env)
- [ ] Vercel Deploy Hook URL → admin `SEO_REBUILD_HOOK_URL` + nightly rebuild
- [ ] Address pin/geo, hours truth (10 AM vs 12 PM), phone confirm, claim verification
      (4.8★/1,240 reviews etc.), real Facebook/Snapchat URLs, GBP/directory links,
      founders/year, `VITE_*` dashboard migration + `git rm --cached .env.production`

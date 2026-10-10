# SEO Implementation Log (branch `seo/geo-overhaul`)

Running log of every SEO change: what, why, evidence, rollback. Latest first.

---

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

# StarKupps SEO + AI-Search Discovery (Phase 0)

Date: 2026-10-10. Author: principal SEO engineer (read-only audit, no code changed).
Scope: whole monorepo at `/home/sam/Downloads/C33293`, primary target `starkupps-web`.

> Evidence rule: every factual claim cites a file path, command output, or URL.
> Anything not verifiable is labeled **UNVERIFIED** and moved to §11 (owner inputs).

---

## 0. Mission brief vs reality (read this first)

Several "known facts" in the mission brief do **not** match the repo. Corrections:

| Mission claim | Reality (evidence) |
|---|---|
| Root folders `.github, .vite, .vscode, scripts, starkupps_rider, starkupps-pos, starkupps-superadmin, starkupps-user` + `AGENTS.md, CONTRIBUTING.md, README.md, LICENSE, .editorconfig, .gitattributes, .nvmrc` | **None of these exist.** Root listing (`read /home/sam/Downloads/C33293`) shows only: `.env`, `.git/.gitignore`, `.provisioned-credentials.json`, `creds.txt`, `docs/`, `running.txt`, `starkupps-access-token-key.txt`, `starkupps-admin/`, `starkupps-creds.txt`, `starkupps-web/`, `supabase/`. No root README/AGENTS/CONTRIBUTING, no CI workflows, no rider/pos/superadmin/user apps |
| Admin app is `starkupps-superadmin` (web admin) | Actual admin is **`starkupps-admin`** — Vite+React SPA + Express/tRPC gateway, deployed to Cloud Run (`starkupps-admin/README.md:6-10,188-190`, `DEPLOY.md:5-7`) |
| GSC "already verified, preserve the method" | **No verification artifact exists anywhere in the repo.** `grep -ril "google-site-verification\|msvalidate\|p:domain_verify\|facebook-domain-verification" starkupps-web/src starkupps-web/public starkupps-web/index.html starkupps-admin/src starkupps-admin/server` → `NONE FOUND`. Verification (if any) must be DNS-side → **UNVERIFIED**, owner action |
| Menu = "cold coffee, mocktails, pizza, burgers, sandwiches" | Live menu also has a **Shakes** category (6 categories, 38 items — see §6) |
| Social URLs given as fact | Instagram resolves (minimal page); X `@StarKupps` exists but has **0 posts** (joined Sep 2026); `snapchat.com/starkupps` → **404**; `facebook.com/page/starkupps` → **404** (pattern is bogus, as suspected) |
| `docs/` has SEO docs | `docs/` has 4 production-audit/architecture files, zero SEO content, and they are **stale** (claim web uses TanStack Start SSR — it does not; see §1) |

---

## 1. Architecture map

### 1.1 Monorepo (actual)

```
C33293/                          (git repo, branch: main, last commit f8a1945 "chores: Initial Commit")
├── starkupps-web/               PUBLIC storefront (PRIMARY TARGET)
│   ├── src/  (api, app/routes[8 files], assets[+responsive], components,
│   │           config, features[auth,cart,checkout,content,instagram,menu,profile],
│   │           lib, state, types, utils)
│   ├── public/  (favicon.ico, favicon.svg, robots.txt — ONLY 3 files)
│   ├── scripts/generate-responsive-images.py  (JPEG derivatives, not prerender)
│   ├── dist/  (built SPA: index.html 2086 B + assets 3.9 MB)
│   ├── index.html, vite.config.ts, vercel.json, package.json, README.md, RESPONSIVE.md
│   └── .env, .env.example, .env.production (⚠ TRACKED — see §8)
├── starkupps-admin/             Ops console + API gateway (SECONDARY)
│   ├── server/  (Express + tRPC; publicRouter.ts = public REST+tRPC surface)
│   ├── src/  (admin SPA incl. SiteContentSettingsPage — meta* fields UI)
│   ├── shared/ (supabase.types.ts, outletServices.ts, instagram.ts, …)
│   ├── README.md, DEPLOY.md, AUTH.md, Dockerfile, .env (untracked)
│   └── dist/, gateway-dev.log
├── supabase/                    Single source of truth (39 migrations + seed.sql)
│   ├── migrations/  20250904* → 20261003* (schema, RLS, instagram, site_settings…)
│   ├── seed.sql  (roles/permissions only, 44 lines)
│   └── config.toml  (project_id="starkupps-admin", pg17)
├── docs/  (4 audit/architecture md — no SEO content)
└── secret-adjacent files at root (see §8)
```

Language/framework/pm: TypeScript throughout; React 19 + Vite 8 + TanStack Router 1 (file-based) + TanStack Query 5 + Supabase JS 2 on web (`starkupps-web/package.json:23-47`); npm + package-lock; Node ≥20.19. No CI (no `.github/`). No `.nvmrc`, no root lint/test gate. Per-app `verify` scripts exist (`lint → typecheck → test → build`).

### 1.2 Data flow (how the public site gets content)

- **Menu/outlets/charges/coupons/orders/site/faqs/reviews/instagram** — fetched at **runtime in the browser** from the admin gateway: REST `GET /api/public/*` with tRPC `public.*` fallback (`starkupps-web/src/api/public.ts:48-58,144-188`; gateway `starkupps-admin/server/index.ts:647-860`, `server/routers/publicRouter.ts`).
- **Live sync** — Supabase Realtime channels (menu 8-table multiplex, `src/api/realtime.ts:26-35,101-175`; site/outlet_hours/reviews/faqs subscriptions in `features/content/useSiteContent.ts`). Enhancement only; refetch-on-focus covers outages.
- **Images** — Supabase Storage public buckets (`product-images`, `category-images`, …) with public-read RLS; bundled JPEG fallbacks in `src/assets/responsive/` (320–1280w).
- **Money** — paise in the web app; gateway prices in **rupees** (`numeric(10,2)`); live variant `effectivePrice` in rupees (sample: Classic Cold Coffee 300ml = ₹50).
- **Copy/NAP** — single row `site_settings` (id=1), edited in Admin > Settings > Storefront, read via `GET /api/public/site` (cache `max-age=30, s-maxage=60`). Web has **zero hardcoded NAP** (`src/config/site.ts:1-11`, `SiteFooter.tsx:6-15`).

### 1.3 Hosting / deployment (verified from repo + live headers)

- Web: **Vercel** (live `server: Vercel`, `x-vercel-cache: HIT`; `vercel.json`: framework vite, `dist` output, SPA rewrite `/(.*)→/index.html`, immutable `/assets/*`, no-cache `index.html`).
- Admin/gateway: **Cloud Run** `https://starkupps-admin-261175458017.asia-northeast2.run.app` (GCP project `starkupps-backend`, region `asia-northeast2`; `starkupps-admin/DEPLOY.md:5-13`, `README.md:188-190`).
- Domains: **both** `starkupps.in` and `starkupps.com` serve the site (apex → www 301/308; `.env.example:36-48` + `DEPLOY.md:94` list all four origins in CORS). **No canonical host decision** — both www hosts return 200 with byte-identical shells (§3).
- CDN/WAF bot-blocking: **no evidence in repo** (no Cloudflare config, no edge middleware, no bot rules in `vercel.json`). All 7 tested bot UAs get 200 (§3). Dashboard-level blocking is **UNVERIFIED** → owner checklist item.

---

## 2. Rendering verdict: CSR-only SPA — the single biggest finding

**Verdict: `starkupps-web` is a 100% client-side-rendered SPA. Crawlers without JavaScript see an empty shell on every route.** Proof chain:

1. `package.json:9-21` — scripts are `dev/build/preview/lint/typecheck/test` only; **no prerender/ssg/postbuild/vite-ssg/react-snap**.
2. Deps — **no** `vite-ssg, vite-plugin-ssr, vike, next, astro, @tanstack/start` (`package.json:23-70`).
3. `vite.config.ts:10-68` — plugins are only `tanstackRouter, tailwindcss, viteReact`; **no SSR block, no prerender plugin**.
4. `vercel.json:8` — **SPA fallback** `rewrites: [{source: "/(.*)", destination: "/index.html"}]`.
5. `src/main.tsx:26-30` — pure `createRoot().render(<RouterProvider>)`; `src/router.tsx:10-21` client router.
6. Head management is **React 19 runtime hoisting** (`src/app/PageMeta.tsx:1-8`), so even `<title>` overrides and all content render post-JS.
7. `dist/index.html` (built output, 45 lines) — `<div id="root"></div>` empty; no content, no canonical, no JSON-LD.
8. Live `curl` of `/` **and every bot UA** returns **2086 bytes** — the empty shell (§3).

Consequence: menu, address, hours, FAQs, reviews, Instagram, About copy, and per-route titles/descriptions are **all invisible** to GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, and to Google/Bing whenever JS rendering is deferred or fails. AI citations are near-impossible in this state. **Fixing server-delivered HTML is Phase 1 priority #1.**

---

## 3. No-JS / crawler reality check (the most important measurements)

Run 2026-10-10 against production (`curl -sL`, sizes = full bodies):

| Test | Result |
|---|---|
| `GET https://starkupps.in/` (Mozilla) | 200 → redirects to `https://www.starkupps.in/`, **2086 B** (empty shell) |
| `GET https://starkupps.com/` | 200 → `https://www.starkupps.com/`, **2086 B** (identical shell — duplicate host, no canonical) |
| `GET /about` (either www host) | **404 `NOT_FOUND` + Vercel error page (79 B)** — the `vercel.json` SPA rewrite is **not effective** in production; deep links are dead to crawlers AND users without JS |
| `GET /sitemap.xml` | **404** (308 → 404; no sitemap exists) |
| `GET /robots.txt` | 200, allow-all, **no `Sitemap:` line** (`starkupps-web/public/robots.txt:1-14`) |
| Bot UAs: GPTBot, OAI-SearchBot, ClaudeBot, Claude-SearchBot, PerplexityBot, Googlebot, bingbot on `/` | All **200 / 2086 B** — not blocked, but served **zero content** |
| Response headers (`/`) | `cache-control: public, max-age=0, must-revalidate`; HSTS `max-age=63072000` ✅; `access-control-allow-origin: *` on HTML (note); ETag present; **no `X-Robots-Tag`**, Brotli/gzip assumed via Vercel (UNVERIFIED — headers tool redacted encoding) |
| Live `<head>` content (raw HTML) | Static title + description + `og:type/site_name/title/description` + `twitter:card` **without image**; `lang="en"`; theme-color; Google Fonts CSS (render-blocking, third-party); **no canonical, no robots meta, no hreflang, no JSON-LD, no verification tag, no manifest link, no og:image/og:url** |
| Search Console verification | **NONE in repo** (grep → `NONE FOUND`); DNS verification **UNVERIFIED** |

**Title/H1/menu/address/hours/JSON-LD/canonical in raw HTML: NONE except the static baseline title/description.** Every public route fails the no-JS test.

---

## 4. Baseline measurements

### 4.1 Lab performance (no Chrome available → measured from build artifacts, conservative)

Lighthouse could **not** be run (no `chromium/chrome` binary in this environment — verified via `which`). First real Lighthouse run is a Phase 1 entry task (owner CI or local). Static budget analysis from `dist/` (built 2026-10-05):

| Asset | Size |
|---|---|
| Total JS (18 chunks) | **1,073,855 B (~1.02 MB)** — react 211 KB, supabase 208 KB, motion 136 KB, tanstack 108 KB, space-images 150 KB, Header 97 KB |
| CSS | 79,221 B |
| Bundled JPEGs (51 files) | **2,710 kB** |
| `dist/` total | **3.9 MB** |
| `index.html` | 2086 B, no-cache ✅ |
| Fonts | Google Fonts remote CSS + 2 families (Fraunces 3 weights, Jakarta 4 weights) — render-blocking third-party, no `display=swap` issue (has `display=swap` ✅) but no self-hosting/preload |

Expected lab verdict (to confirm): LCP hurt by CSR + font chain + 1 MB JS on 4G/Moto-G-class; SEO score capped by empty-shell HTML. **Targets for Phase 1: LCP < 2.5 s, INP < 200 ms, CLS < 0.1, SEO ≥ 95, A11y ≥ 95.**

### 4.2 Crawl inventory (static analysis; 8 routes total)

| Route | Source | Indexable? | No-JS status |
|---|---|---|---|
| `/` | `routes/index.tsx` — hero + CategoryGrid + MenuSection + Trust + Gallery + Instagram + FAQ + Location + Footer | Yes (should be) | ❌ empty shell |
| `/about` | `routes/about.tsx` — founder note, hygiene, directions | Yes (should be) | ❌ **live 404** (rewrite broken) |
| `/login`, `/signup` | auth forms | ⚠ indexable today (no `noIndex` — should be `noindex`) | ❌ shell |
| `/account`, `/auth/callback`, `/auth/update-password` | private flows | ✅ `noIndex` via PageMeta | n/a (private) |
| 404 handler | `route-errors.tsx` client `NotFound` | n/a | ⚠ no HTTP 404 status on client nav (SPA); live deep-links DO 404 at edge (wrong page) |
| `/menu`, `/menu/*`, `/contact`, `/offers`, `/faq`, `/blog/*` | — | **do not exist** | internal links point only to `/`, `/about`, `/login`, `/signup`, `/account`, `#menu`, `#visit` (anchor audit: 6×`to="/"`, 1×`to="/about"`) |

Defects: duplicate/missing titles (all routes share baseline until JS runs); per-route meta exists only post-JS (`PageMeta` supports title/description/og:title/og:description/noIndex — **no canonical, og:image, JSON-LD, hreflang props**); H1s are conditional on DB data (`index.tsx:234` renders H1 only if `site?.heroHeading`); images: `ResponsiveImage` alt path exists but 5 raw `<img>` call sites need alt audit (`InstagramCard.tsx:140`, `OverviewTab.tsx:44`, `account.tsx:125`); cart/checkout are components, not routes (fine); **no sitemap, no canonicals, no OG images, no manifest, `.svg` apple-touch-icon**.

---

## 5. Existing SEO / structured-data inventory

| Item | State |
|---|---|
| JSON-LD / microdata | **None anywhere** (grep `ld+json\|schema.org\|LocalBusiness\|FAQPage` → only noise). Schema validity: n/a (nothing to validate) |
| OG/Twitter | Baseline only, **no `og:image`, `og:url`, `twitter:image`** → link unfurls render text-only |
| Canonical / hreflang / robots meta | **None static**; conditional `noindex,nofollow` only on 3 private routes |
| Sitemap / robots | robots allow-all, no sitemap ref; sitemap **does not exist** |
| Manifest / favicons / social image | No manifest; `favicon.ico+svg` only; no OG image |
| Analytics/events | **None found** (no GA/Plausible/pixel in `index.html` or `src/`); ordering/phone/map/Instagram click events do not exist |
| Admin SEO fields | Only 3 text fields: `metaTitle/metaDescription/metaOgDescription` (validation 200/400/400 chars; UI `SiteContentSettingsPage.tsx:56-58,176-178,345-347`; API `public.site`). **No slug/canonical/og:image/sitemap/robots support** |
| GSC / Bing Webmaster / IndexNow | Nothing in repo; all UNVERIFIED → owner actions |

---

## 6. Data & content inventory (verified from live public API + migrations)

Live `GET /api/public/site` (2026-10-10) and `GET /api/public/menu` — public endpoints by design:

- **NAP (canonical candidate):** StarKupps · `Azad Chowk, Infront Of Jain Dharamshala, Dilawer Pur, Munger, Bihar` (detail adds "Shah Family") · phone/WhatsApp **+91 82524 33504** (`918252433504`) · FSSAI **10424998000217** · `mapsQuery=StarKupps+Main+Road+Munger+Bihar` · **geo: `latitude/longitude = null`** ⚠ (no coordinates — blocks `geo` schema + precise map pin)
- **Hours:** summary `10:00 AM – 11:00 PM`, "Every day, including Sundays"; `weeklyHours` all 7 days `12:00–23:00` ⚠ **contradicts the 10 AM summary** (data bug to resolve with owner)
- **Menu (38 items, all veg, all available):** Cold Coffee 2 (₹50–55) · Shakes 6 (₹55) · Mocktails 9 (₹45–55) · Pizza 9 (₹70–99) · Sandwiches 8 (₹55) · Burger 4 (₹55). Every item has description + imageUrl (Supabase Storage) + variants (ml-based for coffee). Sample: *Classic Cold Coffee — "Slow-churned, served over ice." — 300 ml — ₹50*
- **Trust/stats copy (⚠ accuracy UNVERIFIED — owner must confirm or remove):** "4.8 on Google · 1,240 reviews", "312 orders this week", "Avg. pickup time 9 min", "Single-origin Chikmagalur beans, roasted every 10 days", "Grade A kitchen audit, renewed quarterly", "Twenty-eight seats, free Wi-Fi, plug points at every table". **The "4.8 · 1,240 reviews" claim is exactly the kind of unverifiable rating text that must NEVER become `aggregateRating` schema** (migration itself flags these as owner-supplied, `20261001120100:10-15`).
- **Missing:** geo-coordinates, priceRange string, postal code, founder/team/founding year, delivery-area list, ordering deep links, offers, holiday hours, Instagram settings/posts content (endpoint exists; posts not fetched in this audit), emails (contact@/support@ NOT in site_settings — UNVERIFIED in product), Hindi/Hinglish copy (none).

---

## 7. Competitor & benchmark teardown — mostly UNVERIFIED (web index has no Munger signal)

Two targeted searches (`best cafe in Munger Bihar cold coffee pizza`; `"StarKupps" Munger cafe`) returned **zero Munger-specific cafe results and zero StarKupps web presence** (no GBP, Zomato/Swiggy, Justdial, or directory pages surfaced; X profile exists with 0 posts). Honest conclusion: the brand is currently **invisible in web search**, and local rivals cannot be identified from here — this must be done with on-device Google/Maps searches in India.

| Benchmark brand | What their sites typically do (general web knowledge — VERIFY per-site before copying) | Gap we can win |
|---|---|---|
| Blue Tokai / Third Wave / Chaayos / Starbucks India / CCD | SSR/SSG pages, per-city store pages with address+hours HTML, menu in HTML, LocalBusiness + Menu schema, GBP-linked `hasMap`, OG images, Hindi-optional | Any server-rendered content at all beats our empty shell |
| Cafe Awara (Mukteshwar — surfaced in results; small-cafe reference) | Static HTML menu page + PDF extra, Find-Us/Contact pages with address/hours/phone in HTML, footer NAP | Same playbook fits StarKupps: HTML menu + contact/location + about |
| Local Munger rivals (5–8) | **UNVERIFIED — owner manual checklist:** search "cafe in Munger", "cold coffee Munger", "pizza in Munger" on Google + Maps; record their GBP categories/photos/reviews, Zomato/Swiggy presence, menu format | Claim GBP + citations first; rivals likely have thin/no websites, so HTML menu + schema wins fast |

AI-search presence of competitors: **not measurable from this environment** (no ChatGPT/Perplexity/Gemini access) → procedure defined in future `ai-visibility-tracking.md`; baseline assumption: StarKupps is uncited everywhere (consistent with zero web footprint).

---

## 8. Defect list (ranked)

### CRITICAL
1. **CSR-only public site — zero server-delivered content** (`starkupps-web`, §2). AI crawlers (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot) don't run JS; Google/Bing see an empty shell. Blocks everything. Fix: build-time prerender of public routes from Supabase/gateway data + freshness rebuilds (fits Vite static output + Vercel; no new framework).
2. **`/about` (and any deep link) returns live 404** — `vercel.json:8` SPA rewrite not effective in production (evidence §3). Only `/` resolves. Destroys indexation of all non-home routes + breaks shared links. Fix: Vercel `rewrites` correction / framework preset + verify each route returns 200.
3. **No canonical host decision; `.in` + `.com` serve identical 200 content with no canonical tags** — duplicate-site risk across 4 origins (`starkupps.in/.com`, www variants). Fix: pick one canonical (recommend `https://www.starkupps.in` — shorter, .in ccTLD for India; needs owner sign-off), 301 the rest, self-referencing canonicals everywhere.
4. **Tracked env file `starkupps-web/.env.production`** — `git ls-files` shows it tracked. Contents NOT opened per policy; values are believed to be public `VITE_*` keys. Correction (found 2026-10-10, after this section was written): `starkupps-web/.gitignore` explicitly documents tracking it as intentional (Vercel build needs the API base URL; without the file every request 404s) — so this is a documented trade-off, not an accident. The residual risk stands: any future non-public value committed there leaks, and root `.gitignore` says the opposite. Fix: set dashboard vars first, then `git rm --cached` (owner action #12). (Related hygiene, no contents printed: root `.env`, `creds.txt`, `starkupps-creds.txt`, `starkupps-access-token-key.txt`, `.provisioned-credentials.json`, `running.txt` exist on disk but are **untracked** — confirm they stay that way.)

### HIGH
5. **No sitemap.xml; robots.txt has no `Sitemap:` line; no GSC/Bing verification in repo** — undiscoverable + unverifiable. Fix: generated sitemap (build-time, `lastmod` from content), verification placeholders, sitemap submission (owner).
6. **No structured data at all** — no Organization/WebSite/LocalBusiness/Menu/Breadcrumb/FAQ schema. Fix: server-rendered JSON-LD from same data as pages (§2 entities), CI-validated, `aggregateRating` OMITTED until reviews are proven real/visible.
7. **No-JS invisibility of NAP/hours/menu/prices** (consequence of #1, listed separately because it drives the prerender data contract: menu+site+faqs+reviews+instagram from gateway at build time).
8. **Unverifiable public claims rendered site-wide** — "4.8 on Google · 1,240 reviews", "Grade A kitchen audit", "Single-origin Chikmagalur beans…" (`site_settings` seed). If false, E-E-A-T + AI-trust poison. Fix: owner confirms/rewrites/removes each; never emit as schema.
9. **Hours contradiction** — `hoursSummary` "10:00 AM – 11:00 PM" vs `weeklyHours` "12:00–23:00" daily. Fix: owner picks truth; schema uses `openingHoursSpecification` from `outlet_hours`.
10. **Missing geo-coordinates** (`latitude/longitude null`) — blocks `geo`, `hasMap` precision, delivery-radius truth. Fix: owner drops pin; store in `site_settings`/`outlets`.
11. **OG/Twitter image absent; no manifest; SVG apple-touch-icon** — social shares unfurl poorly; PWA/installability gap. Fix: 1200×630 OG images per key page + manifest + PNG icons.

### MEDIUM
12. `/login`, `/signup` indexable (add `noIndex`); client-only 404 has no HTTP status semantics for in-app nav (edge 404 currently serves wrong page — fixed with #2 + real 404 page).
13. Google Fonts remote chain (2 families, 7 weights) + 1 MB JS + 2.7 MB bundled JPEGs — self-host/subset fonts, code-split audit, AVIF/WebP + `srcset`, LCP preload. (No layout-shift sources found statically; confirm in lab.)
14. Instagram section is JS-only + render-nothing-on-failure (`InstagramSection.tsx:20-22,67`) — must become crawlable server-rendered content (Phase 5), respecting IG terms.
15. Internal linking is skeletal (only `/`, `/about`, auth routes) — needs menu/category/location/FAQ hub pages (Phase 3).
16. `access-control-allow-origin: *` on HTML responses (observed header) — review; harmless for static HTML but inconsistent with gateway's strict allowlist posture.

### LOW
17. Stale `docs/` audits (claim TanStack Start SSR) — refresh after rebuild work so future agents aren't misled.
18. `dist/` committed? `dist/` exists on disk AND `.gitignore:27-43` ignores it — confirm untracked (it did not appear in `git status --short`, ✅ already ignored).
19. Hindi/Hinglish: no evidence yet that separate pages pay off — Phase 1.8 default = single `en` + natural Hinglish phrases in copy; revisit after Search Console data.

---

## 9. Keyword & question map (English + Hindi/Hinglish, by intent)

Seed list for content + FAQ + AI-visibility prompts (volumes UNVERIFIED — validate in GSC/Keyword Planner post-launch):

- **Navigational:** starkupps, starkupps munger, starkupps menu, starkupps contact number, starkupps timing, स्टारकप्स मुंगेर
- **Local:** cafe in munger, best cafe in munger, coffee shop munger bihar, cafe near azad chowk, cafe near me (Munger), मुंगेर में कैफे, मुंगेर में सबसे अच्छा कैफे, munger me cold coffee kahan milega
- **Menu/product:** cold coffee munger, kulhad pizza munger, veg pizza in munger, mocktails munger, burger munger, shakes munger, peri peri sandwich, cheese corn sandwich price, cold coffee price munger
- **Informational (AI-assistant style):** is starkupps open now / open on sundays? where is starkupps in munger? does starkupps have veg pizza? starkupps vs [rival]? what is kulhad pizza? best birthday party cafe munger? student-friendly cafe munger with wifi?
- **Transactional:** order pizza online munger, order cold coffee munger, book table starkupps, starkupps delivery areas, starkupps offers today

---

## 10. Risks

- **Prerender staleness:** menu/prices change in admin; static HTML must rebuild (webhook/scheduled) + IndexNow, or schema drifts from visible content (violates honesty rule).
- **Four-host duplication** until canonical decision ships — do not build links until #3 lands.
- **Unverified claims (#8)** must not ship in schema or AI-facing copy.
- **Rewrite fix (#2)** may change Vercel behavior for `/api` proxy and preview deploys — verify staging first.
- **No test env for AI bots** — post-change bot-UA re-verification is curl-only (no JS execution parity).
- **Secrets hygiene (#4)** — any fix must not print env contents in logs/PRs.

---

## 11. OWNER INPUTS NEEDED (single list — nothing else will be asked unless blocked)

1. **Canonical domain/host:** confirm ONE (recommendation: `https://www.starkupps.in`) + approve 301s for the other three origins.
2. **GSC verification:** is DNS verification in place? Provide owner access or verify; same for Bing Webmaster.
3. **Exact address + map pin + geo-coordinates** (for schema/`hasMap`/footer/GBP).
4. **Phone/WhatsApp:** confirm +91 82524 33504 as public NAP (currently live).
5. **Hours truth:** 10 AM–11 PM vs 12 PM–11 PM daily; plus holiday hours.
6. **Facebook Page:** `facebook.com/page/starkupps` is 404 — send the real Page URL (or confirm none). Same check: real Snapchat profile URL (`snapchat.com/starkupps` 404s); Instagram handle confirmation.
7. **Claim verification:** 4.8★/1,240 Google reviews — true? If yes, link the GBP; if no, remove. Same for Chikmagalur beans / Grade-A audit / 28 seats / pickup-time stats.
8. **GBP URL, Zomato/Swiggy/Justdial/Sulekha links**, delivery areas + ordering links, founders/team/founding year, priceRange wording (₹₹?), postal code.
9. **Training-crawler policy:** default ALLOW (GPTBot/ClaudeBot/CCBot/Google-Extended) for max visibility — confirm or flip.
10. **Hosting access:** Vercel project access (fix rewrite #2, env vars, preview deploys) + confirm staging hostname + Cloud Run deploy hook for rebuild-on-publish.
11. **Blog topics approval** (Phase 3 proposes 5–10; none drafted without sign-off).
12. **Confirm `starkupps-web/.env.production` contains only public `VITE_*` values**, then approve `git rm --cached` + Vercel-env migration.

---

## 12. Prioritized implementation plan (effort in focused work blocks)

| Phase | Work | Effort |
|---|---|---|
| 1a | Fix Vercel SPA rewrite (#2) + verify all routes 200; add real 404 page w/ status | S (½–1 day) |
| 1b | Canonical host decision + 301s + self-referencing canonicals + `noindex` on login/signup | S (½ day, needs owner #1) |
| 1c | **Build-time prerender** of `/`, `/about` (+ new `/menu`, `/contact`, category pages) from gateway/Supabase data; freshness rebuild hook + IndexNow; keep ordering client-side | M–L (3–5 days, core of the project) |
| 1d | Per-page head (title/desc/OG image/manifest/canonical), robots.txt + generated sitemap, GSC/Bing verification placeholders | S–M (1–2 days) |
| 1e | Perf: self-host/subset fonts, AVIF/WebP, LCP preload, JS audit; first real Lighthouse run | M (2 days) |
| 2 | JSON-LD (Organization/WebSite/CafeOrCoffeeShop/Menu/Breadcrumb/FAQ) from same data + CI validator + `entity-sheet.md` | M (2–3 days) |
| 3 | Content: HTML menu + category pages, contact/location, about rewrite, FAQ page, internal hubs; NO blog without approval | M (3–4 days) |
| 4 | AI-crawler robots policy + bot-UA proof log (+ optional `llms.txt` last) | S (½ day) |
| 5 | Crawlable Instagram section + admin fields + `social-seo-playbook.md` | S–M (1–2 days) |
| 6 | `owner-actions.md` (GBP, citations, reviews, SC/Bing steps) | S (½–1 day) |
| 7 | Analytics events + `ai-visibility-tracking.md` + CI guardrails (Lighthouse/no-JS/schema/sitemap/alt/staging-noindex) | M (2 days) |

Rollback path for all code phases: feature branch `seo/geo-overhaul`, small commits, `npm run verify` gate, Vercel preview per commit; prerender is additive (static files alongside SPA) so fallback = current shell.

---

## Appendix — key evidence pointers

- Routes/head: `starkupps-web/src/app/routes/*.tsx`, `src/app/PageMeta.tsx`, `src/router.tsx`, `src/main.tsx`
- Config/deploy: `starkupps-web/vercel.json`, `vite.config.ts`, `index.html`, `public/robots.txt`, `.env.example:36-48`
- Gateway: `starkupps-admin/server/index.ts:606-860`, `server/routers/publicRouter.ts`, `server/routers/siteContentRouter.ts:25-66,141-173`
- Data: `supabase/migrations/20261001120100_site_settings_content.sql`, `20260926080000_instagram_feed.sql`, `20261001120000_*`, `20261002110000_*`, `20261002120000_*`; live `GET /api/public/site`, `GET /api/public/menu` (2026-10-10)
- Live behavior: `curl -sL` `/`, `/about` (404), `/robots.txt` (200), `/sitemap.xml` (404) on `www.starkupps.in/.com`; 7 bot-UAs all 200/2086 B
- Social: `instagram.com/starkupps` (resolves), `x.com/starkupps` (0 posts), `snapchat.com/starkupps` (404), `facebook.com/page/starkupps` (404)
- Secrets: `git ls-files | grep -Ei 'provisioned|access-token|creds|\.env$|…'` → only `starkupps-web/.env.production` tracked

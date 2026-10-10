# Risk Register — StarKupps SEO/AI-search work (branch `seo/geo-overhaul`)

What could regress, what was assumed, and what remains UNVERIFIED. Update on
every SEO change. Owner items live in `owner-actions.md`; this file is for
engineering risk.

## Could regress (guardrail in brackets)

1. **Prerender staleness** — HTML is frozen at build time; a missed rebuild
   serves old prices/hours and schema drifts from the live DB. [Deploy Hook +
   debounced admin trigger + IndexNow-on-build; nightly rebuild still an owner
   action. Monitor: compare a menu price in `curl` HTML vs admin weekly.]
2. **Copy drift (React vs prerender templates)** — about paragraphs, category
   intros and FAQ answers exist in two places. [Mirror comments in
   `prerender.mjs`; `assert-seo` + `validate-jsonld` catch missing strings, not
   rewordings. Any customer-facing copy PR must update both.]
3. **New routes bypassing the pipeline** — a route with `path=` auto-enters the
   sitemap; a public route WITHOUT `path=` is invisible to sitemap/prerender;
   a dynamic route without a manifest entry is unlisted. [assert-seo fails on
   canonical/path mismatches; review checklist: path, canonical, schema,
   sitemap entry per new page.]
4. **Rebuild-hook allowlist gaps** — a NEW storefront-visible mutation in a new
   router fires no rebuild until its path prefix is added to
   `seo-rebuild.ts`. [Unit test pins known paths; code-review rule documented
   in the helper header.]
5. **Secret hygiene** — `starkupps-web/.env.production` is still TRACKED
   (untracking blocked until Vercel env holds the values). Any commit touching
   env files must be reviewed for secrets. Never print env in logs/PRs.
6. **Lab-vs-field gap** — emulated LCP (~4s) is a headless rasterization
   artifact; real localhost LCP is ~200ms. Do NOT "fix" lab LCP with changes
   that hurt real users. CrUX field data post-launch is the arbiter; LHCI
   thresholds are set with margin, not at lab values.
7. **Localhost ≠ production in lab** — gateway CORS blocks localhost, so lab
   runs exercise error states (good for a11y/CLS hardening, bad for content
   screenshots). LHCI `PREVIEW_API_URL` secret makes CI data-ful; without it
   builds go offline warn-only.
8. **Font/image weight creep** — new weights, unoptimized uploads, or a new
   animation library re-inflates boot JS. [LHCI perf warn + TBT/CLS gates;
   images must go through `generate-responsive-images.py` (AVIF included).]
9. **`.dark` token rot** — dark-mode tokens are UNMAINTAINED (no toggle in the
   app); the primary darkening touched light only. If dark mode ships, re-audit
   contrast there.

## Assumed (documented, reversible)

- Canonical host `https://www.starkupps.in` (owner-confirmed 2026-10-10).
- Prices are integer rupees at variant level; `effectivePrice` wins.
- All menu items veg (computed from live data at build; schema follows data).
- `weeklyHours` dayOfWeek 0=Sunday; week starts Monday in tables.
- Latin-only font subsets (site copy is English + latin-script Hinglish).
- Training-crawler default ALLOW (owner decision recorded in robots.txt).
- No on-site search → no WebSite SearchAction. No item-level pages (thin).
- React 19 head-hoisting dedupes identical tags; prerender rewrites the rest.

## UNVERIFIED (do not assert these anywhere until proven)

- GSC/Bing verification + sitemap submission; IndexNow key submission.
- GBP existence/URL; all directory listings; review count/rating claims.
- Hours truth (10 AM vs 12 PM); geo-coordinates; postal code.
- Founders/team/founding year ("Since 2021" renders, unconfirmed).
- FSSAI number; bean/audit/seat/pickup claims; contact@/support@ emails.
- Real Facebook/Snapchat URLs; Instagram bio/GBP linkage.
- Production edge behavior: host redirects, `/menu/*` cleanUrls serving,
  bot-UA responses (curl proofs are pre-deploy; re-run post-deploy).
- Competitor set and AI-citation baseline (first tracking run pending).
- No CDN/WAF bot-blocking (nothing in repo; dashboard check is owner action).

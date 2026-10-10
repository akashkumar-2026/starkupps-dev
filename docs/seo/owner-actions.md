# Owner Actions (things only you can do — no account access on the engineering side)

Ordered by impact. Time estimates are wall-clock per item. Canonical host is
**https://www.starkupps.in** — use it verbatim everywhere below.

## P0 — unblock indexing & freshness (do first)

1. **Vercel env vars (30 min).** Project → Settings → Environment Variables
   (Production): `VITE_API_URL` (= current Cloud Run gateway URL),
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (Supabase dashboard → Project
   Settings → API). Redeploy after setting. Verify: `curl -s
   https://www.starkupps.in/ | grep -c prerendered` → ≥1; `/about` → 200;
   `/sitemap.xml` → 200; non-canonical hosts (`starkupps.in`, `starkupps.com`,
   `www.starkupps.com`) → 308 to `www.starkupps.in`.
2. **Search Console (20 min).** Add property `https://www.starkupps.in`
   (if verification is DNS-based, nothing in the repo changes — the
   `VITE_GSC_VERIFICATION` meta path is ready as an alternative: paste the token
   into Vercel env, redeploy). Submit `https://www.starkupps.in/sitemap.xml`;
   Inspect `/` and `/about`; enable email alerts; add a second owner.
3. **Bing Webmaster (15 min).** Same with the Bing token
   (`VITE_BING_VERIFICATION`); submit the sitemap. This feeds ChatGPT Search/Copilot.
4. **Deploy Hook + nightly rebuild (20 min).** Vercel → Settings → Git → Deploy
   Hooks → create (branch: main) → paste URL into Cloud Run env as
   `SEO_REBUILD_HOOK_URL` → redeploy admin. Add a nightly rebuild (Vercel Cron
   or a daily Deploy-Hook ping) so price/hours edits land within 24 h even if a
   hook misfires. Generate `INDEXNOW_KEY` once (`openssl rand -hex 16`), set it in
   Vercel env, redeploy (writes the key file + auto-submits on every build).
5. **Migrate `VITE_*` off the tracked file (15 min).** Confirm
   `starkupps-web/.env.production` holds ONLY public `VITE_*` values, then:
   `git rm --cached starkupps-web/.env.production` (values already in Vercel env
   from step 1). If anything non-public was ever in it, rotate that secret.

## P1 — business truth (blocks schema upgrades)

6. **Hours truth (5 min).** Display says 10 AM–11 PM, structured schedule says
   12–11 PM daily. Reply with the truth + holiday hours; engineering then enables
   `openingHoursSpecification` schema. Until then hours stay display-only.
7. **Map pin + geo (10 min).** Send the exact Google Maps link/pin; engineering
   stores coordinates → enables `geo` schema + precise embed.
8. **Claim verification (15 min).** Confirm or correct EACH: "4.8 on Google ·
   1,240 reviews" (if true: send GBP URL → enables review links; NEVER becomes
   rating schema until reviews are visible on-page), Chikmagalur beans / 10-day
   roast, Grade-A kitchen audit, 28 seats + free Wi-Fi, 9-min pickup, FSSAI
   10424998000217, "Since 2021", founder/team names. Unconfirmed claims get
   softened or removed — they currently ship site-wide.
9. **NAP confirm (5 min).** Address as printed + phone/WhatsApp +91 82524 33504.
   After any change, say so — footer, schema, sitemap and all citations must match
   character-for-character.

## P2 — profiles & citations (local SEO that engineering cannot do)

10. **Google Business Profile (1–2 h + verification wait).** Claim/verify;
    primary category **Cafe** (+ secondary: Coffee shop, Pizza restaurant as
    applicable); exact NAP + website `https://www.starkupps.in`; hours incl.
    holidays; 20+ real photos; menu/products; attributes; seed Q&A with the FAQ
    questions from the site; weekly Posts; messaging on. Send the GBP URL back —
    it gets wired into schema `sameAs`/`hasMap`.
11. **Reviews process (ongoing).** QR code + short link on bills/tables/WhatsApp
    asking real customers; reply to EVERY review within days; never buy, fake,
    or gate reviews.
12. **Citations with identical NAP (2–3 h).** Bing Places, Apple Business Connect,
    Justdial, Sulekha, Zomato, Swiggy, Facebook Page, Munger/Bihar food & tourism
    listings. Send every listing URL back for the `sameAs` set.
13. **Social URLs (10 min).** `facebook.com/page/starkupps` and
    `snapchat.com/starkupps` both 404 — send the real Page/profile URLs (or confirm
    none exists). Confirm Instagram handle + make it a public Professional account
    with search indexing on; X `@StarKupps` needs its first posts + bio with
    "cafe in Munger, Bihar" + website link. Official emails: confirm
    `contact@starkupps.com` (general) and `support@starkupps.com` (support) —
    neither is in the site data today.
14. **Mentions/PR (ongoing).** Local food bloggers/Instagram creators, college and
    community groups, local news; helpful (non-spammy) answers on Reddit/Quora
    where genuinely relevant. Third-party mentions drive what AI systems cite.

## P3 — decisions & content

15. **Training-crawler policy:** default is ALLOW (shipped). Reply only if you want
    GPTBot/ClaudeBot/CCBot/Google-Extended blocked.
16. **Blog topics:** approve (or reject) before anything is drafted — e.g. cold
    coffee types guide, mocktails served, birthday/group bookings, student-friendly
    cafe guide for Munger. No mass-produced articles, ever.
17. **Staging hygiene:** confirm the preview/staging hostname; set `noindex` there
    (Vercel project protection or `X-Robots-Tag`).
18. **CDN/WAF check:** if Cloudflare (or similar) sits in front of the domain,
    confirm "Block AI Bots"/bot-fight modes are OFF for Googlebot, Bingbot,
    OAI-SearchBot, ClaudeBot/SearchBot, PerplexityBot.

## Verification checklist (after P0)

- [ ] `curl -sL -A PerplexityBot https://www.starkupps.in/ | grep '<h1>'` → hero H1
- [ ] Same with `GPTBot`, `ClaudeBot`, `OAI-SearchBot`, `Googlebot`, `bingbot`
- [ ] `/about` → 200 on all hosts/UAs; `/sitemap.xml` → 200; `/robots.txt` shows AI bots
- [ ] GSC: sitemap submitted, 2 pages indexed; Bing: same
- [ ] Make a test menu-price edit in admin → site rebuilds ≤ ~5 min → new price in
      `curl` HTML (no JS) → IndexNow submission logged in build output

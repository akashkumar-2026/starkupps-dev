# StarKupps Entity Sheet (single source of truth for NAP + identity)

Owner-confirmed canonical host: `https://www.starkupps.in` (2026-10-10).
Stable `@id`s: `https://www.starkupps.in/#organization`, `/#website`, `/#cafe`, `/#menu`.
Generated into every prerendered page from the live gateway by
`starkupps-web/scripts/prerender.mjs` (Phase 2) and checked by
`scripts/validate-jsonld.mjs`. The site reads all of this from ONE row
(`site_settings id=1`, edited in Admin > Settings > Storefront) — never hardcoded.

## Canonical NAP (verbatim from live `GET /api/public/site`, 2026-10-10)

- **Name:** StarKupps
- **Address:** Azad Chowk, Infront Of Jain Dharamshala, Dilawer Pur, Munger, Bihar
  (detail variant: same + "Shah Family")
- **Phone / WhatsApp:** +91 82524 33504 (`918252433504`)
- **Hours (display):** 10:00 AM – 11:00 PM · "Every day, including Sundays"
- **Hours (structured `outlet_hours`):** daily 12:00–23:00 ⚠ CONTRADICTS display — owner must pick truth
- **FSSAI:** 10424998000217
- **Map query:** `StarKupps+Main+Road+Munger+Bihar` → `hasMap` directions URL
- **Geo:** null ⚠ — owner must drop the pin
- **Cuisines (from live menu):** Coffee, Pizza, Burgers, Sandwiches, Mocktails, Shakes (all veg)
- **Price level:** menu ₹45–₹99 (variant-level INR offers in schema)

## sameAs policy (verified live 2026-10-10)

- INCLUDED: `https://instagram.com/starkupps`, `https://x.com/starkupps` (0 posts — real profile)
- EXCLUDED: `snapchat.com/starkupps` (404), `facebook.com/page/starkupps` (404) — need real URLs
- MISSING: Google Business Profile URL, Zomato/Swiggy/Justdial links — owner inputs

## Schema policy (enforced in CI)

- One entity per fact; no duplicate `@id` per page; shared `@id`s across pages OK.
- `aggregateRating`/`Review` FORBIDDEN until real visible reviews exist (endpoint empty today).
- OMITTED until proven: openingHoursSpecification, geo, email/contactPoint,
  foundingDate/founder ("Since 2021" visible on /about but unconfirmed), priceRange,
  acceptsReservations, paymentAccepted, amenityFeature, WebSite SearchAction.

## Where NAP must stay identical

Footer, contact/location section, `/about` licences block, JSON-LD, Instagram/X bios,
Google Business Profile, Bing Places, Apple Business Connect, Justdial, Sulekha,
Zomato, Swiggy, and every local directory (see `owner-actions.md` when written).

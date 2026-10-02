-- ============================================================================
-- Populate site_settings from the values that were hardcoded in the storefront
--
-- These are not invented content. Every value below is copied verbatim from the
-- strings that were already shipping in the starkupps-web bundle
-- (src/config/site.ts, app/routes/index.tsx, features/content/*), i.e. facts the
-- cafe owner had already supplied. This migration only moves them somewhere the
-- admin panel can edit them, so nothing is lost and nothing new is asserted.
--
-- `trustClaim1/2/3`, `galleryBody` and the stat labels are the claims that were
-- previously rendered unconditionally ("1,240 reviews", "312 orders this week",
-- "9 min", "0 items pre-made", "twenty-eight seats, free Wi-Fi"). They are moved
-- across as-is and are now editable, rather than being asserted by code on every
-- page load for ever. If any of them is not accurate it can be corrected from
-- Admin > Settings > Storefront.
--
-- Idempotent: only writes when the row is still at its defaults.
-- ============================================================================

UPDATE public.site_settings SET
  "brandName"      = 'StarKupps',
  "tagline"        = 'Coffee, Pizza & Burgers in Munger',
  "phoneDigits"    = '918252433504',
  "whatsappNumber" = '918252433504',
  "address"        = 'Azad Chowk, Infront Of Jain Dharamshala, Dilawer Pur, Munger, Bihar',
  "addressDetail"  = 'Azad Chowk, Infront Of Jain Dharamshala, Shah Family, Dilawer Pur, Munger, Bihar',
  "mapsQuery"      = 'StarKupps+Main+Road+Munger+Bihar',
  "hoursSummary"   = '10:00 AM – 11:00 PM',
  "hoursShort"     = '10 AM – 11 PM',
  "hoursNote"      = 'Every day, including Sundays',
  "fssaiLicense"   = '10424998000217',

  "heroHeading"    = 'Cold coffee that ruins other cold coffee.',
  "heroSubheading" = 'Munger''s café for slow-churned coffee, hand-stretched pizza and smash burgers. Order in a minute, eat in ten.',
  "heroBadge"      = 'Open now',
  "heroCtaLabel"   = 'Order now',
  "openBadge"      = 'Closes 11 PM',

  "statRatingLabel" = '4.8 on Google · 1,240 reviews',
  "statOrdersLabel" = '312 orders this week',
  "statPickupLabel" = 'Avg. pickup time 9 min',

  "trustHeading"       = 'Licensed, sourced and made in front of you.',
  "trustClaim1"        = 'Single-origin Chikmagalur beans, roasted every 10 days.',
  "trustClaim2"        = 'Pizza dough made fresh daily — never frozen.',
  "trustClaim3"        = 'Grade A kitchen audit, renewed quarterly.',
  "trustPickupStat"    = '9 min',
  "trustPickupCaption" = 'Average pickup time this month',
  "trustPremadeStat"   = '0',
  "trustPremadeCaption" = 'Items pre-made or held warm. Everything starts when you order.',

  "galleryHeading" = 'Munger''s spot to slow down.',
  "galleryBody"    = 'Twenty-eight seats, free Wi-Fi, plug points at every table, and nobody rushing you out.',
  -- Image URLs are resolved by the admin's Storage upload; until then the
  -- storefront renders its own bundled photographs for these slots.
  "galleryImages"  = '[]'::jsonb,

  "menuHeading"      = 'Built to order, out in minutes.',
  "menuEmptyMessage" = 'The menu is being set up. Please check back shortly.',

  "metaTitle"         = 'Coffee, Pizza & Burgers in Munger',
  "metaDescription"   = 'Order cold coffee, hand-stretched pizza and smash burgers from StarKupps, Munger. Dine-in, takeaway or delivery — UPI checkout in under a minute.',
  "metaOgDescription" = 'Fresh dough, smashed patties, serious cold coffee. Order in under a minute.'
WHERE id = 1
  AND "phoneDigits" = ''
  AND "heroHeading" = '';
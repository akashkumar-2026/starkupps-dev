-- Homepage title requested by owner for Google ranking.
UPDATE public.site_settings
SET "metaTitle" = 'StarKupps Cafe | Munger | Good Place Good Vibe',
    "metaDescription" = 'StarKupps Cafe in Munger — slow-churned cold coffee, hand-stretched pizza, burgers, shakes & mocktails. Good place, good vibe. Dine-in, takeaway or delivery.',
    "updatedAt" = now()
WHERE id = 1;

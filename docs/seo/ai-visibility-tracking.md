# AI-Visibility Tracking — StarKupps

Monthly procedure to measure whether ChatGPT, Perplexity, Gemini, Google AI Mode/Overviews
and Claude mention and cite starkupps.in for local cafe queries — and to fix inaccuracies.

## Baseline (2026-10-10, set BEFORE the fix ships)

Brand is ~invisible in web search (zero Munger/StarKupps signal in search results;
X profile 0 posts; Snapchat/Facebook URLs dead). Assume **0% mentioned, 0% cited**
everywhere until the first run proves otherwise. Re-run no earlier than 2–4 weeks
after P0 owner actions (indexing + GBP take time).

## Fixed prompt set (~30 — run verbatim, fresh session each, location = Munger/Bihar)

Navigational (5): "StarKupps menu" · "StarKupps contact number" · "StarKupps Munger
timing" · "StarKupps address" · "Is StarKupps open now"
Local (8): "best cafe in Munger" · "cafe in Munger" · "coffee shop in Munger Bihar" ·
"where can I get cold coffee in Munger" · "pizza in Munger" · "mocktails Munger" ·
"burger Munger" · "cafe near Azad Chowk Munger"
Menu/price (6): "StarKupps cold coffee price" · "kulhad pizza Munger" · "veg pizza in
Munger" · "StarKupps shakes" · "StarKupps burger menu" · "cold coffee price Munger"
Info/transactional (6): "Does StarKupps have veg pizza?" · "Is StarKupps open on
Sundays?" · "Where is StarKupps in Munger?" · "order pizza online Munger" · "birthday
party cafe Munger" · "student-friendly cafe Munger with wifi"
Hindi/Hinglish (5): "मुंगेर में सबसे अच्छा कैफे" · "मुंगेर में कोल्ड कॉफी कहां मिलेगी" ·
"StarKupps का मेनू" · "munger me pizza kahan milega" · "munger me birthday party ke
liye cafe"

## Per-system log (copy this table per run)

| # | Prompt | System | Mentioned? | Cited starkupps.in? | Facts accurate? | Competitors named | Notes/action |
|---|--------|--------|------------|---------------------|-----------------|-------------------|--------------|
| 1 | … | ChatGPT | y/n | y/n (+URL) | y/n (which fact) | … | … |

Systems: ChatGPT (Search on) · Perplexity · Gemini · Google AI Mode · Claude.
Also record Google AI Overviews appearance for the same queries (Search, signed out).

## Targets & actions

- Target (6 months): mentioned in ≥50% of local/menu prompts; cited URL in ≥30%;
  zero material factual errors (address/phone/hours/prices) where cited.
- If NOT mentioned: check GSC indexing + GBP strength + reviews velocity + third-party
  mentions (the usual causes, in that order) — do NOT add more pages; fix distribution.
- If cited but WRONG: trace the source (usually GBP/directory/social bio) → correct it
  there → use GSC URL Inspection "request indexing" → re-test in 2 weeks.
- If a competitor is cited instead: record WHY (their GBP photos/reviews/citations) →
  close that specific gap (owner-actions P2), not generic "more SEO".
- Keep every run's table in this file's history section (append, never overwrite).

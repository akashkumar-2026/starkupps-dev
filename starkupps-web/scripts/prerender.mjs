#!/usr/bin/env node
/**
 * Prerender public routes to static HTML after `vite build`.
 *
 * Runs as the first half of `postbuild`:
 *   `node scripts/prerender.mjs && node scripts/generate-sitemap.mjs`
 *
 * Why this exists
 * ---------------
 * The storefront is a client-side SPA: crawlers without JavaScript
 * (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, and Google/Bing whenever
 * JS rendering is deferred) receive an empty `<div id="root">`. This script
 * fetches the SAME public gateway data the React app renders
 * (`/api/public/site|menu|faqs`) and injects complete, semantic HTML into
 * copies of the built shell, so the first response already contains the
 * title, meta, canonical, H1, menu, prices, NAP, hours and FAQ.
 * Interactive ordering stays client-side; React replaces this markup on boot.
 *
 * Mirror obligation
 * -----------------
 * The templates below intentionally mirror live component copy
 * (`src/app/routes/index.tsx`, `about.tsx`, `features/content/*`). If you
 * change customer-facing copy in those components, update the matching
 * template here. The no-JS CI assertion (Phase 7) checks that key strings
 * (H1, menu names, prices, address) appear in the built HTML.
 *
 * Data & freshness
 * ----------------
 * Gateway base comes from `VITE_API_URL` in the build environment (the same
 * value Vite inlines). If the gateway is unreachable the script WARNS and
 * leaves `dist/` as the SPA shell — the build never fails because of SEO.
 * Freshness window: HTML is as fresh as the last deploy. Rebuild triggers
 * (Deploy Hook on admin publish + schedule) are documented in
 * `docs/seo/implementation-log.md`; `lastmod` in the sitemap upgrades to
 * content `updatedAt` once the hook lands.
 *
 * IndexNow (Bing → ChatGPT Search / Copilot coverage)
 * ---------------------------------------------------
 * If `INDEXNOW_KEY` is set in the build environment, the script writes
 * `dist/<KEY>.txt` (key-location proof) and submits changed canonical URLs
 * to api.indexnow.org. Fail-open: submission errors only warn.
 *
 * JSON-LD (Phase 2) is emitted here too, from the same fetched payloads —
 * Organization, WebSite, CafeOrCoffeeShop, Menu and FAQPage/BreadcrumbList —
 * so markup and visible content cannot drift. `scripts/validate-jsonld.mjs`
 * (next postbuild step) parses every block and fails the build on invalid
 * JSON, duplicate @id, missing required props, schema-vs-visible mismatches,
 * or placeholder values. Deliberately omitted fields are listed in the
 * JSON-LD section below with reasons.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");

// --- origin guardrail: single source of truth is src/config/site.ts ---------
const siteConfig = readFileSync(join(root, "src/config/site.ts"), "utf8");
const originMatch = siteConfig.match(/CANONICAL_ORIGIN\s*=\s*"([^"]+)"/);
if (!originMatch) {
  console.error("prerender: CANONICAL_ORIGIN not found in src/config/site.ts — refusing to guess.");
  process.exit(1);
}
const ORIGIN = originMatch[1];

const GATEWAY = (process.env["VITE_API_URL"] ?? "").replace(/\/+$/, "");
if (!GATEWAY) {
  console.warn("prerender: VITE_API_URL unset — leaving SPA shell as-is (no-JS content skipped).");
  process.exit(0);
}

const shellPath = join(distDir, "index.html");
if (!existsSync(shellPath)) {
  console.error("prerender: dist/index.html missing — run after vite build.");
  process.exit(1);
}
const shell = readFileSync(shellPath, "utf8");

// --- helpers ----------------------------------------------------------------
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const inr = (n) => `₹${n}`;
const BRAND = "StarKupps";
const fullTitle = (t) => (t.includes(BRAND) ? t : `${t} — ${BRAND}`);

async function fetchJson(path) {
  const res = await fetch(`${GATEWAY}${path}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

/** LCP preload for the home hero (bundled photo, eager + fetchpriority=high in React). */
function heroPreloadLink() {
  try {
    const assets = readdirSync(join(distDir, "assets"));
    const set = assets
      .filter((f) => /^hero-coffee-\d+-.*\.avif$/.test(f))
      .map((f) => {
        const w = Number(/^hero-coffee-(\d+)-/.exec(f)[1]);
        // Origin-relative on purpose: resolves to the canonical host in
        // production AND matches locally, so the preload is never wasted.
        // (og:image stays absolute — scrapers require it.)
        return { w, href: `/assets/${f}` };
      })
      .sort((a, b) => a.w - b.w);
    if (!set.length) return null;
    const srcset = set.map((s) => `${s.href} ${s.w}w`).join(", ");
    return `<link rel="preload" as="image" imagesrcset="${srcset}" imagesizes="100vw" type="image/avif" fetchpriority="high" />`;
  } catch {
    return null;
  }
}

/** Absolute canonical og:image: built hero photo, else largest bundled photo, else null. */
function resolveOgImage() {
  try {
    const assets = readdirSync(join(distDir, "assets"));
    const hero = assets.filter((f) => f.startsWith("hero-coffee-") && f.endsWith(".jpg")).sort();
    const wide = assets.filter((f) => /-1280\.jpg$/.test(f)).sort();
    const pick = hero[hero.length - 1] ?? wide[wide.length - 1] ?? null;
    return pick ? `${ORIGIN}/assets/${pick}` : null;
  } catch {
    return null;
  }
}

function priceLabel(item) {
  const prices = (item.variants ?? [])
    .filter((v) => v.available !== false)
    .map((v) => v.effectivePrice ?? v.price)
    .filter((p) => typeof p === "number");
  if (!prices.length) return "";
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return lo === hi ? inr(lo) : `${inr(lo)}–${inr(hi)}`;
}

function telHref(digits) {
  return digits && digits.trim() ? `tel:+${digits.trim()}` : null;
}

/** Mirror of src/utils/format.ts slugify — keep identical or slugs 404. */
function slugify(value) {
  return String(value).toLowerCase().trim().replace(/\s+/g, "-");
}

/** Mirror of src/features/menu/category-summary.ts summarizeCategory. */
function summarizeCat(items) {
  const prices = (items ?? [])
    .flatMap((i) => i.variants ?? [])
    .filter((v) => v.available !== false)
    .map((v) => v.effectivePrice ?? v.price)
    .filter((p) => typeof p === "number");
  const lo = prices.length ? Math.min(...prices) : null;
  const hi = prices.length ? Math.max(...prices) : null;
  return {
    count: (items ?? []).length,
    range: lo === null || hi === null ? "" : lo === hi ? `₹${lo}` : `₹${lo}–₹${hi}`,
    allVeg: (items ?? []).length > 0 && (items ?? []).every((i) => i.veg === true),
  };
}

/** Mirror of the contact route's displayTime: "12:00" → "12:00 PM". */
function displayTime(value) {
  if (!value) return "";
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!m) return value;
  const h24 = Number(m[1]);
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Categories with items, in menu order — the hub spokes. */
function visibleCategories(menu) {
  const counts = new Map();
  for (const item of menu.items ?? []) {
    if (item.effectiveComingSoon) continue;
    counts.set(item.categoryName, (counts.get(item.categoryName) ?? 0) + 1);
  }
  return (menu.categories ?? []).filter((c) => !c.comingSoon && (counts.get(c.name) ?? 0) > 0);
}

function itemsFor(menu, categoryName) {
  return (menu.items ?? []).filter(
    (i) => i.categoryName === categoryName && !i.effectiveComingSoon,
  );
}

/** Grouped item listing shared by home and the menu hub. */
function menuSectionsHtml(menu) {
  return visibleCategories(menu)
    .map((c) => {
      const items = itemsFor(menu, c.name);
      const lis = items
        .map((i) => {
          const price = priceLabel(i);
          const diet = i.veg === false ? "Non-veg" : i.veg === true ? "Veg" : "";
          return `<li><h4>${esc(i.name)}</h4>${i.description ? `<p>${esc(i.description)}</p>` : ""}<p>${[price, diet].filter(Boolean).join(" · ")}</p></li>`;
        })
        .join("\n");
      return `<section aria-label="${esc(c.name)}"><h3>${esc(c.name)}</h3>${c.description ? `<p>${esc(c.description)}</p>` : ""}<ul>${lis}</ul></section>`;
    })
    .join("\n");
}

/** Mirror of src/config/site.ts phoneDisplay: `918252433504` → `+91 82524 33504`. */
function phoneDisplay(digits) {
  const d = (digits ?? "").trim();
  if (/^91\d{10}$/.test(d)) return `+91 ${d.slice(2, 4)} ${d.slice(4, 8)} ${d.slice(8)}`;
  if (/^\d{10}$/.test(d)) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  return d ? `+${d}` : "";
}

// --- JSON-LD (Phase 2) --------------------------------------------------------
// One canonical entity per real-world fact, generated from the SAME gateway
// payloads as the visible markup above, so schema and content cannot drift.
// Stable @id URIs connect nodes across pages ({ORIGIN}/#organization …).
//
// Deliberately OMITTED (schema honesty — never guess):
// - openingHoursSpecification: weeklyHours (12:00–23:00) contradicts the visible
//   hoursSummary (10 AM–11 PM). Owner must pick the truth (owner-actions #5).
// - geo / precise hasMap pin: latitude/longitude are null in site_settings.
// - aggregateRating/Review: live reviews endpoint is empty AND the "4.8 · 1,240
//   reviews" stat strip is an unverified owner claim — markup would be fake.
// - email/contactPoint, foundingDate/founder, priceRange, acceptsReservations,
//   paymentAccepted, amenityFeature: not in verified data. Add only with proof.
// - WebSite SearchAction: no on-site search exists.

/** Split "Street…, Munger, Bihar" into PostalAddress parts; falls back honestly. */
function postalAddress(raw) {
  const text = (raw ?? "").trim();
  const mungerTail = /^(.*),\s*Munger,\s*Bihar\s*$/i.exec(text);
  if (mungerTail && mungerTail[1].trim()) {
    return {
      "@type": "PostalAddress",
      streetAddress: mungerTail[1].trim(),
      addressLocality: "Munger",
      addressRegion: "Bihar",
      addressCountry: "IN",
    };
  }
  return { "@type": "PostalAddress", streetAddress: text, addressCountry: "IN" };
}

function availabilityOf(item, variant) {
  return item.available !== false && variant.available !== false
    ? "https://schema.org/InStock"
    : "https://schema.org/OutOfStock";
}

function menuNode(menu) {
  const cats = (menu.categories ?? []).filter((c) => !c.comingSoon);
  const itemsByCat = new Map();
  for (const item of menu.items ?? []) {
    if (item.effectiveComingSoon) continue;
    if (!itemsByCat.has(item.categoryName)) itemsByCat.set(item.categoryName, []);
    itemsByCat.get(item.categoryName).push(item);
  }
  const sections = [];
  for (const c of cats) {
    const items = itemsByCat.get(c.name) ?? [];
    if (!items.length) continue;
    sections.push({
      "@type": "MenuSection",
      name: c.name,
      ...(c.description ? { description: c.description } : {}),
      hasMenuItem: items.map((i) => ({
        "@type": "MenuItem",
        name: i.name,
        ...(i.description ? { description: i.description } : {}),
        ...(i.imageUrl ? { image: i.imageUrl } : {}),
        ...(i.veg === true ? { suitableForDiet: "https://schema.org/VegetarianDiet" } : {}),
        offers: (i.variants ?? [])
          .filter((v) => typeof (v.effectivePrice ?? v.price) === "number")
          .map((v) => ({
            "@type": "Offer",
            ...(v.quantity ? { name: `${v.quantity}${v.unit ? ` ${v.unit}` : ""}` } : {}),
            priceCurrency: "INR",
            price: v.effectivePrice ?? v.price,
            availability: availabilityOf(i, v),
          })),
      })),
    });
  }
  return {
    "@type": "Menu",
    "@id": `${ORIGIN}/#menu`,
    name: `${BRAND} menu`,
    hasMenuSection: sections,
  };
}

function baseNodes(site, ogImage) {
  const digits = (site.phoneDigits ?? "").trim();
  const mapsQuery = site.mapsQuery?.trim() || site.address?.trim();
  const organization = {
    "@type": "Organization",
    "@id": `${ORIGIN}/#organization`,
    name: site.brandName?.trim() || BRAND,
    url: `${ORIGIN}/`,
    ...(ogImage ? { logo: ogImage } : {}),
    ...(site.tagline ? { description: `${site.tagline} in Munger, Bihar` } : {}),
    knowsAbout: [
      "cold coffee",
      "mocktails",
      "pizza",
      "burgers",
      "sandwiches",
      "shakes",
      "cafe in Munger",
    ],
    // sameAs: ONLY profiles verified live on 2026-10-10. snapchat.com/starkupps
    // → 404 and facebook.com/page/starkupps → 404 are EXCLUDED until the owner
    // supplies real URLs (owner-actions #6).
    sameAs: ["https://instagram.com/starkupps", "https://x.com/starkupps"],
  };
  const website = {
    "@type": "WebSite",
    "@id": `${ORIGIN}/#website`,
    url: `${ORIGIN}/`,
    name: site.brandName?.trim() || BRAND,
    publisher: { "@id": `${ORIGIN}/#organization` },
    inLanguage: "en",
  };
  // CafeOrCoffeeShop: the most specific accurate type — a cafe serving coffee
  // PLUS pizza/burgers/sandwiches (Restaurant alone would understate coffee;
  // FoodEstablishment is less specific).
  const cafe = {
    "@type": "CafeOrCoffeeShop",
    "@id": `${ORIGIN}/#cafe`,
    name: site.brandName?.trim() || BRAND,
    url: `${ORIGIN}/`,
    ...(ogImage ? { image: ogImage } : {}),
    ...(site.address ? { address: postalAddress(site.address) } : {}),
    ...(digits ? { telephone: `+${digits}` } : {}),
    servesCuisine: ["Coffee", "Pizza", "Burgers", "Sandwiches", "Mocktails", "Shakes"],
    hasMenu: { "@id": `${ORIGIN}/#menu` },
    ...(mapsQuery ? { hasMap: `https://maps.google.com/?q=${encodeURIComponent(mapsQuery)}` } : {}),
  };
  return { organization, website, cafe };
}

function homeGraph(site, menu, ogImage) {
  const { organization, website, cafe } = baseNodes(site, ogImage);
  // NOTE: the home FAQ section stays visible but unschematized — the single
  // canonical FAQPage lives on /faq, so AI systems get one Q&A source of truth.
  return {
    "@context": "https://schema.org",
    "@graph": [organization, website, cafe, menuNode(menu)],
  };
}

/** crumbs: [{name, item?}] — item omitted for the current page. */
function breadcrumbGraph(crumbs, idBase) {
  return {
    "@type": "BreadcrumbList",
    "@id": `${ORIGIN}${idBase}#breadcrumbs`,
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      ...(c.item ? { item: c.item } : {}),
    })),
  };
}

function menuGraph(site, menu, ogImage) {
  const { organization, website } = baseNodes(site, ogImage);
  return {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      website,
      menuNode(menu),
      breadcrumbGraph(
        [
          { name: "Home", item: `${ORIGIN}/` },
          { name: "Menu", item: `${ORIGIN}/menu` },
        ],
        "/menu",
      ),
    ],
  };
}

function categoryGraph(site, categoryName, ogImage) {
  const { organization, website } = baseNodes(site, ogImage);
  const slug = slugify(categoryName);
  return {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      website,
      {
        "@type": "BreadcrumbList",
        "@id": `${ORIGIN}/menu/${slug}#breadcrumbs`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${ORIGIN}/` },
          { "@type": "ListItem", position: 2, name: "Menu", item: `${ORIGIN}/menu` },
          { "@type": "ListItem", position: 3, name: categoryName },
        ],
      },
    ],
  };
}

function contactGraph(site, ogImage) {
  const { organization, website, cafe } = baseNodes(site, ogImage);
  return {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      website,
      cafe,
      breadcrumbGraph(
        [
          { name: "Home", item: `${ORIGIN}/` },
          { name: "Contact", item: `${ORIGIN}/contact` },
        ],
        "/contact",
      ),
    ],
  };
}

function faqGraph(site, faqs, ogImage) {
  const { organization, website } = baseNodes(site, ogImage);
  const graph = [organization, website];
  if ((faqs ?? []).length) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${ORIGIN}/faq#main`,
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.answer },
      })),
    });
  }
  const crumbs = breadcrumbGraph(
    [
      { name: "Home", item: `${ORIGIN}/` },
      { name: "FAQ", item: `${ORIGIN}/faq` },
    ],
    "/faq",
  );
  graph.push(crumbs);
  return { "@context": "https://schema.org", "@graph": graph };
}

function aboutGraph(site, ogImage) {
  const { organization, website, cafe } = baseNodes(site, ogImage);
  return {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      website,
      cafe,
      {
        "@type": "BreadcrumbList",
        "@id": `${ORIGIN}/about#breadcrumbs`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${ORIGIN}/` },
          { "@type": "ListItem", position: 2, name: "About", item: `${ORIGIN}/about` },
        ],
      },
    ],
  };
}

// --- head -------------------------------------------------------------------
function buildHead({ path, title, description, ogDescription, jsonLd }) {
  const canonical = `${ORIGIN}${path}`;
  const ogImage = resolveOgImage();
  let head = shell;
  head = head.replace(/<title>.*?<\/title>/s, `<title>${esc(fullTitle(title))}</title>`);
  head = head.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/>/,
    `<meta name="description" content="${esc(description)}" />`,
  );
  head = head.replace(
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/>/,
    `<meta property="og:title" content="${esc(fullTitle(title))}" />`,
  );
  head = head.replace(
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/>/,
    `<meta property="og:description" content="${esc(ogDescription || description)}" />`,
  );
  head = head.replace(
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/,
    `<link rel="canonical" href="${canonical}" />`,
  );
  const extras = [
    `<meta property="og:url" content="${canonical}" />`,
    ogImage
      ? `<meta property="og:image" content="${ogImage}" />\n    <meta property="og:image:alt" content="${esc(`${BRAND} cafe`)}" />\n    <meta name="twitter:image" content="${ogImage}" />`
      : null,
    // LCP hint for the home hero only — other pages preload nothing.
    path === "/" ? heroPreloadLink() : null,
    jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : null,
  ]
    .filter(Boolean)
    .join("\n    ");
  head = head.replace("</head>", `    ${extras}\n  </head>`);
  return head;
}

// --- home body ---------------------------------------------------------------
function buildHomeBody(site, menu, faqs) {
  const tel = telHref(site.phoneDigits);
  const wa = site.whatsappNumber?.trim() ? `https://wa.me/${site.whatsappNumber.trim()}` : null;
  const mapsQuery = site.mapsQuery?.trim() || site.address?.trim();
  const directions = mapsQuery
    ? `https://maps.google.com/?q=${encodeURIComponent(mapsQuery)}`
    : null;
  const cats = visibleCategories(menu);
  const menuSections = menuSectionsHtml(menu);
  const faqBlock = (faqs ?? [])
    .map((f) => `<div><h3>${esc(f.question)}</h3><p>${esc(f.answer)}</p></div>`)
    .join("\n");
  return `<header><nav aria-label="Primary"><a href="${ORIGIN}/">${esc(site.brandName || BRAND)}</a> <a href="${ORIGIN}/about">About</a></nav></header>
<main>
<section><p>${esc(site.heroBadge || "")}</p><h1>${esc(site.heroHeading || site.tagline || BRAND)}</h1><p>${esc(site.heroSubheading || "")}</p></section>
<section aria-label="Menu" id="menu"><h2>${esc(site.menuHeading || "Menu")}</h2>
<nav aria-label="Menu categories"><ul>${cats.map((c) => `<li>${esc(c.name)}</li>`).join("")}</ul></nav>
${menuSections}</section>
<section aria-label="Why trust us"><h2>${esc(site.trustHeading || "")}</h2><ul>${[
    site.trustClaim1,
    site.trustClaim2,
    site.trustClaim3,
  ]
    .filter(Boolean)
    .map((t) => `<li>${esc(t)}</li>`)
    .join("")}</ul></section>
<section aria-label="Gallery"><h2>${esc(site.galleryHeading || "")}</h2><p>${esc(site.galleryBody || "")}</p></section>
${faqBlock ? `<section aria-label="Frequently asked questions"><h2>Frequently asked questions</h2>${faqBlock}</section>` : ""}
<section aria-label="Visit us"><h2>Find us in Munger</h2><address>${esc(site.address || "")}</address><p>${esc(site.hoursSummary || "")}${site.hoursNote ? ` · ${esc(site.hoursNote)}` : ""}</p>
<p>${tel ? `<a href="${tel}">Call ${esc(site.phoneDigits.trim())}</a>` : ""} ${wa ? `<a href="${wa}">WhatsApp us</a>` : ""} ${directions ? `<a href="${esc(directions)}">Get directions</a>` : ""}</p></section>
</main>
<footer><p>${esc(site.brandName || BRAND)} — ${esc(site.tagline || "")}</p><p>${esc(site.address || "")}</p>${site.fssaiLicense ? `<p>FSSAI licence ${esc(site.fssaiLicense)}</p>` : ""}<nav aria-label="Footer"><a href="${ORIGIN}/">Home</a> <a href="${ORIGIN}/about">About</a></nav></footer>`;
}

function siteHeader(site) {
  return `<header><nav aria-label="Primary"><a href="${ORIGIN}/">${esc(site.brandName || BRAND)}</a> <a href="${ORIGIN}/menu">Menu</a> <a href="${ORIGIN}/about">About</a> <a href="${ORIGIN}/contact">Contact</a></nav></header>`;
}

function siteFooter(site) {
  return `<footer><p>${esc(site.brandName || BRAND)} — ${esc(site.tagline || "")}</p><p>${esc(site.address || "")}</p>${site.fssaiLicense ? `<p>FSSAI licence ${esc(site.fssaiLicense)}</p>` : ""}<nav aria-label="Footer"><a href="${ORIGIN}/">Home</a> <a href="${ORIGIN}/menu">Menu</a> <a href="${ORIGIN}/about">About</a> <a href="${ORIGIN}/contact">Contact</a> <a href="${ORIGIN}/faq">FAQ</a></nav></footer>`;
}

function crumbsHtml(items) {
  return `<nav aria-label="Breadcrumb"><ol>${items
    .map((c) =>
      c.to
        ? `<li><a href="${c.to}">${esc(c.label)}</a></li>`
        : `<li aria-current="page">${esc(c.label)}</li>`,
    )
    .join("")}</ol></nav>`;
}

// --- menu hub ---------------------------------------------------------------
function buildMenuBody(site, menu) {
  const cats = visibleCategories(menu);
  const total = (menu.items ?? []).filter((i) => !i.effectiveComingSoon).length;
  const cards = cats
    .map((c) => {
      const s = summarizeCat(itemsFor(menu, c.name));
      return `<li><a href="${ORIGIN}/menu/${slugify(c.name)}">${esc(c.name)} — ${s.count} items${s.range ? ` · ${s.range}` : ""}</a>${c.description ? `<p>${esc(c.description)}</p>` : ""}</li>`;
    })
    .join("\n");
  return `${siteHeader(site)}
<main>
${crumbsHtml([{ label: "Home", to: `${ORIGIN}/` }, { label: "Menu" }])}
<h1>The StarKupps menu.</h1>
<p>${total > 0 ? `Everything we make, in one place: ${total} items across ${cats.length} categories, all vegetarian. Order for dine-in, takeaway or delivery in Munger.` : "Everything we make, in one place."}</p>
<nav aria-label="Menu categories"><ul>${cards}</ul></nav>
<section aria-label="Full menu" id="menu"><h2>Full menu with prices</h2>${menuSectionsHtml(menu)}</section>
</main>
${siteFooter(site)}`;
}

// --- category page -----------------------------------------------------------
function buildCategoryBody(site, menu, cat) {
  const slug = slugify(cat.name);
  const items = itemsFor(menu, cat.name);
  const s = summarizeCat(items);
  const siblings = visibleCategories(menu)
    .filter((c) => c.name !== cat.name)
    .map((c) => `<li><a href="${ORIGIN}/menu/${slugify(c.name)}">${esc(c.name)}</a></li>`)
    .join("");
  const lis = items
    .map((i) => {
      const price = priceLabel(i);
      const diet = i.veg === false ? "Non-veg" : i.veg === true ? "Veg" : "";
      return `<li><h3>${esc(i.name)}</h3>${i.description ? `<p>${esc(i.description)}</p>` : ""}<p>${[price, diet].filter(Boolean).join(" · ")}</p></li>`;
    })
    .join("\n");
  return `${siteHeader(site)}
<main>
${crumbsHtml([{ label: "Home", to: `${ORIGIN}/` }, { label: "Menu", to: `${ORIGIN}/menu` }, { label: cat.name }])}
<h1>${esc(cat.name)} at ${esc(site.brandName || BRAND)}.</h1>
<p>${cat.description ? `${esc(cat.description)} ` : ""}${s.count > 0 ? `${s.count} option${s.count === 1 ? "" : "s"}${s.range ? ` from ${s.range}` : ""}, made to order at our Munger café. ` : ""}${s.allVeg ? "Everything here is vegetarian. " : ""}<a href="${ORIGIN}/menu">See the full menu</a> or <a href="${ORIGIN}/contact">find us</a>.</p>
<section aria-label="${esc(cat.name)}"><h2>${esc(cat.name)} — all items</h2><ul>${lis}</ul></section>
${siblings ? `<nav aria-label="More menu categories"><h2>More from the menu</h2><ul>${siblings}</ul></nav>` : ""}
</main>
${siteFooter(site)}`;
}

// --- contact -----------------------------------------------------------------
function buildContactBody(site) {
  const tel = telHref(site.phoneDigits);
  const wa = site.whatsappNumber?.trim() ? `https://wa.me/${site.whatsappNumber.trim()}` : null;
  const mapsQuery = site.mapsQuery?.trim() || site.address?.trim();
  const directions = mapsQuery
    ? `https://maps.google.com/?q=${encodeURIComponent(mapsQuery)}`
    : null;
  const mapEmbed = mapsQuery
    ? `https://www.google.com/maps?q=${encodeURIComponent(mapsQuery)}&output=embed`
    : null;
  const hours = site.weeklyHours ?? [];
  const sunday = hours.find((h) => h.dayOfWeek === 0);
  const rows = [1, 2, 3, 4, 5, 6, 0]
    .map((d) => {
      const h = hours.find((row) => row.dayOfWeek === d);
      const val =
        !h || !h.isOpen
          ? "Closed"
          : h.openTime && h.closeTime
            ? `${displayTime(h.openTime)} – ${displayTime(h.closeTime)}`
            : site.hoursShort || "";
      return `<tr><th scope="row">${DAY_NAMES[d]}</th><td>${esc(val)}</td></tr>`;
    })
    .join("");
  return `${siteHeader(site)}
<main>
${crumbsHtml([{ label: "Home", to: `${ORIGIN}/` }, { label: "Contact" }])}
<h1>Find us in Munger.</h1>
<section aria-label="Address"><h2>Where is StarKupps in Munger?</h2><address>${esc(site.address || "")}</address>${site.addressDetail && site.addressDetail !== site.address ? `<p>Landmark: ${esc(site.addressDetail)}</p>` : ""}
<p>${directions ? `<a href="${esc(directions)}">Get directions</a>` : ""} ${tel ? `<a href="${tel}">Call ${esc(phoneDisplay(site.phoneDigits))}</a>` : ""} ${wa ? `<a href="${wa}">WhatsApp us</a>` : ""}</p>
${mapEmbed ? `<iframe title="Map showing the StarKupps cafe in Munger" src="${esc(mapEmbed)}" loading="lazy"></iframe>` : ""}</section>
<section aria-label="Hours"><h2>When is StarKupps open?</h2>${sunday ? `<p>${sunday.isOpen ? "Yes — we are open on Sundays." : "We are closed on Sundays."}${site.hoursNote ? ` ${esc(site.hoursNote)}.` : ""}</p>` : ""}${hours.length ? `<table><caption>Opening hours by day</caption><tbody>${rows}</tbody></table>` : site.hoursSummary ? `<p>${esc(site.hoursSummary)}</p>` : ""}</section>
<section aria-label="Contact"><h2>How do I contact StarKupps?</h2><p>Call or WhatsApp us for orders, party bookings and feedback. <a href="${ORIGIN}/menu">See the full menu</a>.</p></section>
</main>
${siteFooter(site)}`;
}

// --- faq ---------------------------------------------------------------------
function buildFaqBody(site, faqs) {
  const blocks = (faqs ?? [])
    .map((f) => `<div><h2>${esc(f.question)}</h2><p>${esc(f.answer)}</p></div>`)
    .join("\n");
  return `${siteHeader(site)}
<main>
${crumbsHtml([{ label: "Home", to: `${ORIGIN}/` }, { label: "FAQ" }])}
<h1>Questions, answered.</h1>
<p>Everything about ordering from ${esc(site.brandName || BRAND)} in Munger. Still stuck? <a href="${ORIGIN}/contact">Contact us</a>.</p>
<section aria-label="Frequently asked questions">${blocks}</section>
</main>
${siteFooter(site)}`;
}

// --- about body (mirrors src/app/routes/about.tsx copy) ----------------------
function buildAboutBody(site) {
  const tel = telHref(site.phoneDigits);
  const mapsQuery = site.mapsQuery?.trim() || site.address?.trim();
  const directions = mapsQuery
    ? `https://maps.google.com/?q=${encodeURIComponent(mapsQuery)}`
    : null;
  const hours = site.hoursSummary || "";
  return `<header><nav aria-label="Primary"><a href="${ORIGIN}/">${esc(site.brandName || BRAND)}</a> <a href="${ORIGIN}/about">About</a></nav></header>
<main>
<p>Since 2021 · Munger, Bihar</p>
<h1>We started because nobody here made a decent cold coffee.</h1>
<p>StarKupps started with a simple observation: in Munger, finding a good, affordable cup of coffee wasn’t easy. The same was true in nearby Jamalpur and the surrounding towns. There were plenty of places for chai and snacks, but very few options for clean, quality coffee at a price people could enjoy regularly.</p>
<p>We wanted to change that.</p>
<p>At StarKupps, we focus on serving fresh, quality coffee that is prepared with care and processed through hygienic methods. From the ingredients we use to the way we prepare and serve every cup, cleanliness and quality come first.</p>
<p>Our goal is simple — to make good coffee affordable, accessible, and enjoyable for everyone in Munger and the nearby areas.</p>
<p>${esc(site.brandName || BRAND)} — quality coffee, made clean and served fresh.</p>
<section aria-label="Licences and hygiene"><h2>Licences &amp; hygiene</h2>
<dl>${site.fssaiLicense ? `<div><dt>FSSAI licence</dt><dd>${esc(site.fssaiLicense)}</dd></div>` : ""}${site.trustClaim3 ? `<div><dt>Kitchen hygiene audit</dt><dd>${esc(site.trustClaim3)}</dd></div>` : ""}${hours ? `<div><dt>Hours</dt><dd>${esc(hours)}${site.hoursNote ? `, ${esc(site.hoursNote.toLowerCase())}` : ""}</dd></div>` : ""}</dl></section>
<p><address>${esc(site.address || "")}</address></p>
<p>${directions ? `<a href="${esc(directions)}">Get directions in Google Maps</a>` : ""} ${tel ? `<a href="${tel}">Call ${esc(phoneDisplay(site.phoneDigits))}</a>` : ""}</p>
</main>
<footer><p>${esc(site.brandName || BRAND)} — ${esc(site.tagline || "")}</p><nav aria-label="Footer"><a href="${ORIGIN}/">Home</a> <a href="${ORIGIN}/about">About</a></nav></footer>`;
}

function inject(shellHtml, headHtml, bodyHtml, label) {
  const stamp = new Date().toISOString().slice(0, 10);
  let out = headHtml;
  out = out.replace(
    '<div id="root"></div>',
    `<div id="root"><!-- prerendered:${label}:${stamp} -->\n${bodyHtml}\n</div>`,
  );
  return out;
}

// --- IndexNow ----------------------------------------------------------------
async function submitIndexNow(urls) {
  const key = (process.env["INDEXNOW_KEY"] ?? "").trim();
  if (!key) {
    console.warn(
      "prerender: INDEXNOW_KEY unset — skipping IndexNow submission (set it in Vercel env).",
    );
    return;
  }
  writeFileSync(join(distDir, `${key}.txt`), key);
  try {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: "www.starkupps.in",
        key,
        keyLocation: `${ORIGIN}/${key}.txt`,
        urlList: urls,
      }),
      signal: AbortSignal.timeout(20000),
    });
    console.log(`prerender: IndexNow → HTTP ${res.status} for ${urls.length} URLs.`);
  } catch (err) {
    console.warn(`prerender: IndexNow submission failed (fail-open): ${err.message}`);
  }
}

// --- main --------------------------------------------------------------------
const t0 = Date.now();
let site, menu, faqs;
try {
  [site, menu, faqs] = await Promise.all([
    fetchJson("/api/public/site"),
    fetchJson("/api/public/menu"),
    fetchJson("/api/public/faqs").catch(() => []),
  ]);
} catch (err) {
  console.warn(`prerender: gateway fetch failed (${err.message}) — leaving SPA shell as-is.`);
  process.exit(0);
}

const homeMeta = {
  path: "/",
  title: site.metaTitle || BRAND,
  description: site.metaDescription || "Cold coffee, pizza and burgers in Munger, Bihar.",
  ogDescription: site.metaOgDescription || "",
};
const aboutMeta = {
  path: "/about",
  title: "About StarKupps — Munger's coffee, pizza & burger café",
  description:
    "How StarKupps started in Munger, Bihar: our founder's note, our kitchen, FSSAI licensing, and where to find us.",
  ogDescription: "A founder's note, a look inside the kitchen, and directions to the café.",
};

const ogImage = resolveOgImage();
const today = new Date().toISOString().slice(0, 10);
const manifest = []; // Dynamic routes (category slugs) the sitemap merges in.

function emit(relPath, meta, body) {
  // Vercel cleanUrls serves `/menu/x` from `dist/menu/x.html`, so every route
  // maps to a sibling .html file — never a directory, never extensionless.
  const file = relPath === "/" ? shellPath : join(distDir, `${relPath.slice(1)}.html`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, inject(shell, buildHead(meta), body, relPath));
  const lastmod = meta.lastmod || today;
  manifest.push({ path: relPath, lastmod });
  return `${ORIGIN}${relPath}`;
}

const urls = [];
urls.push(
  emit(
    "/",
    { ...homeMeta, jsonLd: homeGraph(site, menu, ogImage) },
    buildHomeBody(site, menu, faqs),
  ),
);
urls.push(
  emit("/about", { ...aboutMeta, jsonLd: aboutGraph(site, ogImage) }, buildAboutBody(site)),
);

// Menu hub.
urls.push(
  emit(
    "/menu",
    {
      path: "/menu",
      title: "Menu",
      description:
        "The full StarKupps menu in Munger: cold coffee, shakes, mocktails, pizza, sandwiches and burgers, with prices. All vegetarian.",
      ogDescription: "Every cold coffee, pizza, burger and mocktail we make — with prices.",
      jsonLd: menuGraph(site, menu, ogImage),
    },
    buildMenuBody(site, menu),
  ),
);

// One page per live category slug (unknown slugs 404 in the app — never emitted).
for (const cat of visibleCategories(menu)) {
  const slug = slugify(cat.name);
  const items = itemsFor(menu, cat.name);
  const s = summarizeCat(items);
  const lastmod = (cat.updatedAt ?? "").slice(0, 10) || today;
  urls.push(
    emit(
      `/menu/${slug}`,
      {
        path: `/menu/${slug}`,
        title: `${cat.name} in Munger`,
        description:
          `${cat.name} at StarKupps, Munger${cat.description ? ` — ${cat.description}` : ""}${s.range ? ` From ${s.range}.` : ""} All vegetarian.`.slice(
            0,
            160,
          ),
        ogDescription: `${cat.name} in Munger — ${s.count} options${s.range ? ` from ${s.range}` : ""}.`,
        lastmod,
        jsonLd: categoryGraph(site, cat.name, ogImage),
      },
      buildCategoryBody(site, menu, cat),
    ),
  );
}

// Contact + FAQ.
urls.push(
  emit(
    "/contact",
    {
      path: "/contact",
      title: "Contact & location",
      description:
        "Find StarKupps in Munger: address near Azad Chowk, opening hours, phone and WhatsApp, plus directions.",
      ogDescription: "Address, hours, phone and directions to StarKupps, Munger.",
      lastmod: (site.updatedAt ?? "").slice(0, 10) || today,
      jsonLd: contactGraph(site, ogImage),
    },
    buildContactBody(site),
  ),
);
urls.push(
  emit(
    "/faq",
    {
      path: "/faq",
      title: "FAQ",
      description: `StarKupps Munger FAQs: menu, ordering, hours and location${(faqs ?? []).length ? ` — ${faqs.length} answers` : ""}.`,
      ogDescription: "Answers about the StarKupps menu, ordering, hours and location.",
      jsonLd: faqGraph(site, faqs, ogImage),
    },
    buildFaqBody(site, faqs),
  ),
);

writeFileSync(join(distDir, "seo-manifest.json"), JSON.stringify({ routes: manifest }, null, 2));

const itemCount = (menu.items ?? []).length;
const catCount = visibleCategories(menu).length;
console.log(
  `prerender: ${urls.length} pages written in ${Date.now() - t0}ms (${catCount} categories, ${itemCount} items, ${(faqs ?? []).length} FAQs).`,
);

await submitIndexNow(urls);

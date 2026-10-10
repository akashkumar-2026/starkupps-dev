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
 * JSON-LD is NOT emitted here — Phase 2 extends this script with schema
 * generated from the same fetched payloads, so markup and content cannot
 * drift apart.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
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

// --- head -------------------------------------------------------------------
function buildHead({ path, title, description, ogDescription }) {
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
  const cats = (menu.categories ?? []).filter((c) => !c.comingSoon);
  const itemsByCat = new Map();
  for (const item of menu.items ?? []) {
    if (item.effectiveComingSoon) continue;
    if (!itemsByCat.has(item.categoryName)) itemsByCat.set(item.categoryName, []);
    itemsByCat.get(item.categoryName).push(item);
  }
  const menuSections = cats
    .map((c) => {
      const items = itemsByCat.get(c.name) ?? [];
      if (!items.length) return "";
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
  const faqBlock = (faqs ?? [])
    .map((f) => `<div><h3>${esc(f.question)}</h3><p>${esc(f.answer)}</p></div>`)
    .join("\n");
  return `<header><nav aria-label="Primary"><a href="${ORIGIN}/">${esc(site.brandName || BRAND)}</a> <a href="${ORIGIN}/about">About</a></nav></header>
<main>
<section><p>${esc(site.heroBadge || "")}</p><h1>${esc(site.heroHeading || site.tagline || BRAND)}</h1><p>${esc(site.heroSubheading || "")}</p></section>
<section aria-label="Menu"><h2>${esc(site.menuHeading || "Menu")}</h2>
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
<p>${directions ? `<a href="${esc(directions)}">Get directions in Google Maps</a>` : ""} ${tel ? `<a href="${tel}">Call us</a>` : ""}</p>
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

writeFileSync(
  shellPath,
  inject(shell, buildHead(homeMeta), buildHomeBody(site, menu, faqs), "home"),
);
writeFileSync(
  join(distDir, "about.html"),
  inject(shell, buildHead(aboutMeta), buildAboutBody(site), "about"),
);

const itemCount = (menu.items ?? []).length;
const catCount = (menu.categories ?? []).length;
console.log(
  `prerender: home + about written in ${Date.now() - t0}ms (${catCount} categories, ${itemCount} items, ${(faqs ?? []).length} FAQs).`,
);

await submitIndexNow([`${ORIGIN}/`, `${ORIGIN}/about`]);
console.log(`prerender: basename check — ${basename(shellPath)} + about.html.`);

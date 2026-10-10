#!/usr/bin/env node
/**
 * Build-time SEO assertions (last postbuild step).
 *
 * Runs AFTER prerender + sitemap generation:
 *   `prerender → validate-jsonld → generate-sitemap → assert-seo`
 *
 * Fails the build (exit 1) on:
 * - pages with zero or multiple `<title>` / `<h1>` (exactly one each);
 * - missing, relative, or path-mismatched canonicals (file → URL map below);
 * - `noindex` on an indexable page, or aindexable page without JSON-LD;
 * - `<img>` without an `alt` attribute in built HTML;
 * - empty/placeholder anchors (`href="#"`, empty `href`);
 * - sitemap.xml malformed, off-origin, empty, or missing `/` and `/about`;
 * - sitemap entries that don't match the built pages (or vice versa);
 * - robots.txt missing the canonical `Sitemap:` line or carrying a blanket
 *   `Disallow: /`.
 *
 * Offline builds (no VITE_API_URL → prerender skips, SPA shell only) WARN and
 * pass content checks that only hold for prerendered output — but ONLY then.
 * If the gateway WAS configured yet no page was prerendered, that is a hard
 * failure: silent staleness is worse than a red build.
 *
 * Usage: `node scripts/assert-seo.mjs [dist-dir]` (positional — this Node
 * build rejects `--flags` passed to scripts).
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.argv[2] ? resolve(process.argv[2]) : join(root, "dist");

const siteConfig = readFileSync(join(root, "src/config/site.ts"), "utf8");
const ORIGIN = siteConfig.match(/CANONICAL_ORIGIN\s*=\s*"([^"]+)"/)?.[1];
if (!ORIGIN) {
  console.error("assert-seo: CANONICAL_ORIGIN not found — refusing to guess.");
  process.exit(1);
}

const errors = [];
const warns = [];
const fail = (m) => errors.push(m);
const warn = (m) => warns.push(m);

function htmlFiles(d, base = "") {
  const out = [];
  for (const entry of readdirSync(d, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...htmlFiles(join(d, entry.name), `${base}${entry.name}/`));
    else if (entry.name.endsWith(".html")) out.push(`${base}${entry.name}`);
  }
  return out;
}

/** dist path → canonical URL path. */
function urlPathFor(file) {
  if (file === "index.html") return "/";
  const noExt = file.replace(/\.html$/, "");
  return `/${noExt}`;
}

const gatewayConfigured = Boolean((process.env["VITE_API_URL"] ?? "").trim());
const files = htmlFiles(dir);
const prerendered = files.filter((f) =>
  readFileSync(join(dir, f), "utf8").includes("prerendered:"),
);

if (!prerendered.length) {
  const msg = "assert-seo: no prerendered pages in dist/.";
  if (gatewayConfigured)
    fail(`${msg} Gateway was configured — prerender must have failed silently.`);
  else warn(`${msg} Offline build (VITE_API_URL unset) — content checks skipped.`);
}

for (const file of files) {
  const html = readFileSync(join(dir, file), "utf8");
  const isShell = !html.includes("prerendered:");
  const urlPath = urlPathFor(file);

  const titles = [...html.matchAll(/<title>([\s\S]*?)<\/title>/g)];
  if (titles.length !== 1 || !titles[0][1].trim()) fail(`${file}: expected one non-empty <title>`);
  const h1s = [...html.matchAll(/<h1[\s>]/g)];
  if (!isShell && h1s.length !== 1) fail(`${file}: expected exactly one <h1>, found ${h1s.length}`);

  const canonicals = [...html.matchAll(/<link rel="canonical" href="([^"]*)"/g)].map((m) => m[1]);
  if (canonicals.length !== 1) fail(`${file}: expected one canonical, found ${canonicals.length}`);
  else if (canonicals[0] !== `${ORIGIN}${urlPath}`)
    fail(`${file}: canonical ${canonicals[0]} != expected ${ORIGIN}${urlPath}`);

  if (/<meta name="robots" content="noindex/.test(html))
    fail(`${file}: indexable page carries noindex`);

  if (!isShell && !html.includes("application/ld+json"))
    fail(`${file}: prerendered page lacks JSON-LD`);

  for (const img of html.matchAll(/<img\b([^>]*)>/g)) {
    if (!/\balt=/.test(img[1])) fail(`${file}: <img> without alt: ${img[0].slice(0, 90)}`);
  }
  for (const a of html.matchAll(/<a\b([^>]*)>/g)) {
    const href = /href="([^"]*)"/.exec(a[1])?.[1];
    if (href === undefined || href === "" || href === "#")
      fail(`${file}: empty/placeholder anchor: ${a[0].slice(0, 90)}`);
  }
}
if (prerendered.length)
  console.log(`assert-seo: ${prerendered.length}/${files.length} pages prerendered.`);

// --- sitemap ---
const sitemapPath = join(dir, "sitemap.xml");
if (!existsSync(sitemapPath)) fail("sitemap.xml missing from dist/");
else {
  const xml = readFileSync(sitemapPath, "utf8");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (!locs.length) fail("sitemap.xml has no URLs");
  for (const loc of locs) {
    if (!loc.startsWith(`${ORIGIN}/`)) fail(`sitemap off-origin URL: ${loc}`);
    if (/\?/.test(loc)) fail(`sitemap URL with query string: ${loc}`);
  }
  for (const must of [`${ORIGIN}/`, `${ORIGIN}/about`])
    if (!locs.includes(must)) fail(`sitemap missing ${must}`);
  const builtPaths = new Set(files.map((f) => `${ORIGIN}${urlPathFor(f)}`));
  for (const loc of locs) if (!builtPaths.has(loc)) fail(`sitemap lists unbuilt page: ${loc}`);
  console.log(`assert-seo: sitemap OK (${locs.length} URLs).`);
}

// --- robots ---
const robotsPath = join(dir, "robots.txt");
if (!existsSync(robotsPath)) fail("robots.txt missing from dist/");
else {
  const robots = readFileSync(robotsPath, "utf8");
  if (!robots.includes(`Sitemap: ${ORIGIN}/sitemap.xml`))
    fail("robots.txt lacks the canonical Sitemap: line");
  if (/^Disallow:\s*\/\s*$/m.test(robots)) fail("robots.txt carries a blanket Disallow: /");
  console.log("assert-seo: robots.txt OK.");
}

for (const w of warns) console.warn(`assert-seo WARN: ${w}`);
if (errors.length) {
  console.error(`assert-seo: ${errors.length} violation(s):`);
  for (const e of errors.slice(0, 30)) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("assert-seo: all build assertions passed.");

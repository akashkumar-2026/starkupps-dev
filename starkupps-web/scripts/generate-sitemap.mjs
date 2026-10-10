#!/usr/bin/env node
/**
 * Generate `dist/sitemap.xml` after `vite build` (wired as `postbuild`).
 *
 * Why a script and not a plugin
 * ------------------------------
 * The route set is tiny and file-based (`src/app/routes/*.tsx`). A sitemap
 * plugin would add a dependency between the code and a build that currently
 * works; a ~60-line stdlib-only script cannot break the bundle.
 *
 * How routes are chosen
 * ---------------------
 * Static routes: a route file is listed iff it declares a `path="..."` in its
 * `<PageMeta>` (the same prop that renders the self-referencing canonical) AND
 * does not contain `noIndex`. Auth/account routes are therefore excluded
 * automatically; adding `path` to a future public route adds it here with no
 * other change. Dynamic segments (`$slug`) are skipped in the static scan.
 *
 * Dynamic routes: `scripts/prerender.mjs` writes `dist/seo-manifest.json` with
 * one entry per live category slug (validated against menu data — unknown
 * slugs 404 in the app and are never emitted). This script merges the manifest
 * in, so the sitemap always matches the HTML that was actually built. Offline
 * builds (no gateway → no manifest) fall back to static routes only.
 *
 * Origin guardrail
 * ----------------
 * The origin MUST match `CANONICAL_ORIGIN` in `src/config/site.ts`. The
 * script reads that constant and fails the build on mismatch rather than
 * silently emitting a second "canonical" host.
 *
 * `lastmod` is the route file's mtime (date precision). Once the prerender
 * step (Phase 1c) exists, this upgrades to the content `updatedAt`.
 *
 * Usage: `node scripts/generate-sitemap.mjs [out-file]` (positional — this
 * Node build rejects `--flags` passed to scripts).
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routesDir = join(root, "src/app/routes");

const outFile = process.argv[2] ? resolve(process.argv[2]) : join(root, "dist/sitemap.xml");

// Single source of truth lives in src/config/site.ts — never duplicate it here.
const siteConfig = readFileSync(join(root, "src/config/site.ts"), "utf8");
const originMatch = siteConfig.match(/CANONICAL_ORIGIN\s*=\s*"([^"]+)"/);
if (!originMatch) {
  console.error(
    "generate-sitemap: CANONICAL_ORIGIN not found in src/config/site.ts — refusing to guess.",
  );
  process.exit(1);
}
const ORIGIN = originMatch[1];

const entries = [];
const seen = new Set();
function add(loc, lastmod, priority) {
  if (seen.has(loc)) return;
  seen.add(loc);
  entries.push({ loc, lastmod, priority });
}
for (const file of readdirSync(routesDir)) {
  if (!file.endsWith(".tsx") || file === "__root.tsx") continue;
  const full = join(routesDir, file);
  const src = readFileSync(full, "utf8");
  const pathMatch = src.match(/<PageMeta[\s\S]*?path="([^"]+)"/);
  if (!pathMatch) continue; // No canonical path declared → not a public indexable page.
  if (/\bnoIndex\b/.test(src)) continue; // Utility/private route → keep out of the index.
  const routePath = pathMatch[1];
  if (routePath.includes("$") || routePath.includes("*")) continue; // Dynamic → manifest only.
  const mtime = statSync(full).mtime;
  const lastmod = mtime.toISOString().slice(0, 10);
  const priority = routePath === "/" ? "1.0" : "0.8";
  add(`${ORIGIN}${routePath}`, lastmod, priority);
}

// Dynamic category pages from the prerender manifest (if the build fetched data).
const manifestFile = join(dirname(outFile), "seo-manifest.json");
try {
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  for (const r of manifest.routes ?? []) {
    if (typeof r.path === "string" && r.path.startsWith("/menu/")) {
      add(`${ORIGIN}${r.path}`, r.lastmod || new Date().toISOString().slice(0, 10), "0.7");
    }
  }
  console.log(
    `generate-sitemap: merged ${(manifest.routes ?? []).length} prerendered dynamic routes.`,
  );
} catch {
  console.warn("generate-sitemap: no seo-manifest.json (offline build?) — static routes only.");
}

entries.sort((a, b) => a.loc.localeCompare(b.loc));

const xml =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  entries
    .map(
      (e) =>
        `  <url>\n    <loc>${e.loc}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n    <priority>${e.priority}</priority>\n  </url>`,
    )
    .join("\n") +
  `\n</urlset>\n`;

if (!existsSync(dirname(outFile))) {
  console.error(
    `generate-sitemap: output directory missing (${dirname(outFile)}) — run after vite build.`,
  );
  process.exit(1);
}
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, xml);
console.log(
  `generate-sitemap: wrote ${entries.length} URLs (${entries.map((e) => e.loc).join(", ")}) → ${outFile}`,
);

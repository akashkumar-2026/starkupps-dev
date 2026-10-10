#!/usr/bin/env node
/**
 * Validate every JSON-LD block in the prerendered HTML (postbuild guardrail).
 *
 * Runs AFTER `scripts/prerender.mjs`:
 *   `prerender → validate-jsonld → generate-sitemap`
 *
 * Fails the build (exit 1) on:
 * - unparseable JSON-LD, or a block missing `@context`/`@type`;
 * - duplicate `@id` within one page (one canonical entity per fact);
 * - missing required properties per our policy (Organization: name+url;
 *   CafeOrCoffeeShop: name+address+telephone; Menu: non-empty hasMenuSection;
 *   MenuItem: name + ≥1 Offer with INR price; FAQPage: non-empty mainEntity;
 *   BreadcrumbList: ≥2 items);
 * - FORBIDDEN schema: `aggregateRating`/`Review` — allowed only when real,
 *   visible, verifiable reviews exist on that page (today: none);
 * - schema-vs-visible drift: address/phone/menu-item/FAQ strings in the markup
 *   must appear in the page's visible text (tags stripped, entities decoded);
 * - placeholder values: empty strings, "TODO", "lorem", "example.com".
 *
 * Usage: `node scripts/validate-jsonld.mjs [dist-dir]` (positional — this
 * Node build rejects `--flags` passed to scripts).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.argv[2] ? resolve(process.argv[2]) : join(root, "dist");

const errors = [];

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ");
}

function checkPlaceholders(value, where) {
  const s = typeof value === "string" ? value : "";
  if (s.trim() === "") errors.push(`${where}: empty string value`);
  if (/todo|lorem|example\.com|placeholder/i.test(s))
    errors.push(`${where}: placeholder value "${s.slice(0, 60)}"`);
}

function walk(node, fn) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, fn));
  if (node && typeof node === "object") {
    fn(node);
    for (const v of Object.values(node)) walk(v, fn);
  }
}

function htmlFiles(dir, base = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...htmlFiles(join(dir, entry.name), `${base}${entry.name}/`));
    else if (entry.name.endsWith(".html")) out.push(`${base}${entry.name}`);
  }
  return out;
}

const files = htmlFiles(dir);
if (!files.length) {
  console.error("validate-jsonld: no HTML files in dist/ — run after prerender.");
  process.exit(1);
}

for (const file of files) {
  const html = readFileSync(join(dir, file), "utf8");
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (!blocks.length) {
    console.log(`validate-jsonld: ${file} — no JSON-LD (shell-only build), skipping.`);
    continue;
  }
  const seenIds = new Set();
  const text = visibleText(html);
  for (const [, raw] of blocks) {
    let doc;
    try {
      doc = JSON.parse(raw);
    } catch {
      errors.push(`${file}: invalid JSON in JSON-LD block`);
      continue;
    }
    const graph = doc["@graph"] ?? [doc];
    if (!doc["@context"]) errors.push(`${file}: block missing @context`);
    for (const node of graph) {
      if (!node["@type"]) {
        errors.push(`${file}: node missing @type`);
        continue;
      }
      if (node["@id"]) {
        if (seenIds.has(node["@id"])) errors.push(`${file}: duplicate @id ${node["@id"]}`);
        seenIds.add(node["@id"]);
      }
      walk(node, (n) => {
        if (n["@type"] === "AggregateRating" || n["@type"] === "Review")
          errors.push(`${file}: ${n["@type"]} forbidden without real visible reviews`);
        for (const [k, v] of Object.entries(n))
          if (typeof v === "string") checkPlaceholders(v, `${file} ${n["@type"]}.${k}`);
      });
      switch (node["@type"]) {
        case "Organization":
          if (!node.name || !node.url) errors.push(`${file}: Organization needs name+url`);
          break;
        case "CafeOrCoffeeShop":
          if (!node.name || !node.address || !node.telephone)
            errors.push(`${file}: CafeOrCoffeeShop needs name+address+telephone`);
          else {
            const street = node.address.streetAddress ?? "";
            if (street && !text.includes(street.slice(0, 20)))
              errors.push(`${file}: address not found in visible text`);
            const digits = String(node.telephone).replace(/\D/g, "").slice(-10);
            if (digits && !text.replace(/\D/g, "").includes(digits))
              errors.push(`${file}: telephone not found in visible text`);
          }
          break;
        case "Menu": {
          const sections = node.hasMenuSection ?? [];
          if (!sections.length) errors.push(`${file}: Menu has no sections`);
          for (const s of sections)
            for (const item of s.hasMenuItem ?? []) {
              if (!item.name) errors.push(`${file}: MenuItem without name`);
              else if (!text.includes(item.name))
                errors.push(`${file}: menu item "${item.name}" not in visible text`);
              const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
              if (!offers.length || !offers[0])
                errors.push(`${file}: MenuItem "${item.name}" has no Offer`);
              for (const o of offers) {
                if (!o || o.priceCurrency !== "INR" || typeof o.price !== "number")
                  errors.push(`${file}: MenuItem "${item.name}" Offer needs INR numeric price`);
              }
            }
          break;
        }
        case "FAQPage": {
          const qs = node.mainEntity ?? [];
          if (!qs.length) errors.push(`${file}: FAQPage has no questions`);
          for (const q of qs)
            if (q.name && !text.includes(q.name.slice(0, 30)))
              errors.push(`${file}: FAQ "${q.name.slice(0, 40)}…" not in visible text`);
          break;
        }
        case "BreadcrumbList":
          if ((node.itemListElement ?? []).length < 2)
            errors.push(`${file}: BreadcrumbList needs ≥2 items`);
          break;
      }
    }
  }
  console.log(`validate-jsonld: ${file} — ${blocks.length} block(s) checked.`);
}

if (errors.length) {
  console.error(`validate-jsonld: ${errors.length} violation(s):`);
  for (const e of errors.slice(0, 30)) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("validate-jsonld: all JSON-LD valid, no drift detected.");

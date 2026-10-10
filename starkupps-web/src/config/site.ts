/**
 * Brand and contact facts, read live from `public.site_settings`.
 *
 * There is deliberately no static copy of the phone number, address, hours or
 * FSSAI licence anywhere in this app any more. Those used to be literals in this
 * file and in three components, which meant the admin panel could not correct
 * them and the site asserted them on every page load regardless of what the
 * database held.
 *
 * Use `useSiteSettings()` rather than importing from here.
 */
import type { PublicSiteSettings } from "@/types/site";

export type SiteSettings = PublicSiteSettings;

/**
 * Canonical origin for SEO — owner-confirmed 2026-10-10 (see
 * `docs/seo/00-discovery.md` §11 item 1). Every public URL's canonical,
 * sitemap entry, robots `Sitemap:` line and JSON-LD `@id` derives from this
 * single constant so `.in`/`.com` + apex/www can never drift apart.
 * Non-canonical hosts 301 to this origin at the edge (`vercel.json`).
 */
export const CANONICAL_ORIGIN = "https://www.starkupps.in";

/** Absolute canonical URL for a site path (`"/"` → origin + `"/"`). */
export function canonicalUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${CANONICAL_ORIGIN}${clean}`;
}

/**
 * Verified-live social profiles (checked 2026-10-10; keep in sync with the
 * Organization sameAs in `scripts/prerender.mjs`). Snapchat/Facebook are
 * deliberately absent — both URL patterns 404. Add them only with confirmed
 * URLs (owner-actions #6/#13).
 */
export const SOCIAL_LINKS = [
  { label: "StarKupps on Instagram", href: "https://instagram.com/starkupps" },
  { label: "StarKupps on X", href: "https://x.com/starkupps" },
] as const;

/** Built from live settings. Empty strings yield no link, by design. */
export function siteLinks(site: SiteSettings) {
  const mapsQuery = site.mapsQuery.trim();
  const mapsSearch = mapsQuery || site.address.trim();
  return {
    directions: mapsSearch ? `https://maps.google.com/?q=${encodeURIComponent(mapsSearch)}` : null,
    mapEmbed: mapsSearch
      ? `https://www.google.com/maps?q=${encodeURIComponent(mapsSearch)}&output=embed`
      : null,
    whatsapp: site.whatsappNumber.trim() ? `https://wa.me/${site.whatsappNumber.trim()}` : null,
    tel: site.phoneDigits.trim() ? `tel:+${site.phoneDigits.trim()}` : null,
  } as const;
}

/** `918252433504` → `+91 82524 33504`, best effort for display only. */
export function phoneDisplay(phoneDigits: string): string {
  const digits = phoneDigits.trim();
  if (!digits) return "";
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+91 ${digits.slice(2, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`;
  }
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return `+${digits}`;
}

/** Up to two uppercase initials for an avatar/quote marker. */
export function initialsOf(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}

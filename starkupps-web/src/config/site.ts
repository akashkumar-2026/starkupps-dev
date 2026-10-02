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

/**
 * Single source of truth for brand, contact and legal copy.
 *
 * These values appear in the footer, the location section and the about page;
 * keeping them here stops the three from drifting apart.
 */

export const SITE = {
  name: "StarKupps",
  tagline: "Coffee, Pizza & Burgers in Munger",
  address: "Azad Chowk, Infront Of Jain Dharamshala, Dilawer Pur, Munger, Bihar",
  addressDetail: "Azad Chowk, Infront Of Jain Dharamshala, Shah Family, Dilawer Pur, Munger, Bihar",
  /** 10-digit Indian mobile, digits only. */
  phoneDigits: "918252433504",
  /** Human-readable E.164 form used in `tel:` links and copy. */
  phoneDisplay: "+91 82524 33504",
  hours: "10:00 AM – 11:00 PM",
  hoursShort: "10 AM – 11 PM",
  fssai: "10424998000217",
  mapsQuery: "StarKupps+Main+Road+Munger+Bihar",
} as const;

export const SITE_LINKS = {
  directions: `https://maps.google.com/?q=${SITE.mapsQuery}`,
  mapEmbed: `https://www.google.com/maps?q=${SITE.mapsQuery}&output=embed`,
  whatsapp: `https://wa.me/${SITE.phoneDigits}`,
  tel: `tel:+${SITE.phoneDigits}`,
} as const;

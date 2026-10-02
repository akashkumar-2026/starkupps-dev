/**
 * Storefront business facts, served by the gateway from `public.site_settings`.
 *
 * Every field is owner-editable from Admin > Settings > Storefront. An empty
 * string means "not configured" and the storefront renders an honest
 * placeholder or omits the element — it never substitutes a hardcoded value.
 */
export type PublicSiteSettings = {
  brandName: string;
  tagline: string;
  /** Digits only, no leading `+`/`0`. Empty when unconfigured. */
  phoneDigits: string;
  whatsappNumber: string;
  address: string;
  addressDetail: string;
  /** Pre-encoded query for a maps embed/directions link. */
  mapsQuery: string;
  latitude: number | null;
  longitude: number | null;
  hoursSummary: string;
  hoursShort: string;
  hoursNote: string;
  fssaiLicense: string;
  heroHeading: string;
  heroSubheading: string;
  heroBadge: string;
  heroCtaLabel: string;
  openBadge: string;
  statRatingLabel: string;
  statOrdersLabel: string;
  statPickupLabel: string;
  trustHeading: string;
  trustClaim1: string;
  trustClaim2: string;
  trustClaim3: string;
  trustPickupStat: string;
  trustPickupCaption: string;
  trustPremadeStat: string;
  trustPremadeCaption: string;
  galleryHeading: string;
  galleryBody: string;
  galleryImages: {
    url: string;
    alt: string;
    span: "" | "sm:col-span-2";
  }[];
  menuHeading: string;
  menuEmptyMessage: string;
  metaTitle: string;
  metaDescription: string;
  metaOgDescription: string;
  updatedAt: string;
};

/** A customer review, served from `public.testimonials`. */
export type PublicReview = {
  id: number;
  authorName: string;
  authorRole: string | null;
  content: string;
  rating: number;
  createdAt: string;
};

/**
 * Storefront business facts, served by the gateway from `public.site_settings`.
 *
 * Every field is owner-editable from Admin > Settings > Storefront. An empty
 * string means "not configured" and the storefront renders an honest
 * placeholder or omits the element — it never substitutes a hardcoded value.
 */
/** One day of the store's weekly schedule, served from `outlet_hours`. */
export type PublicWeeklyHour = {
  /** 0 = Sunday, matching JS `Date#getDay()`. */
  dayOfWeek: number;
  isOpen: boolean;
  /** `HH:mm` 24-hour, or null when the day is closed / unset. */
  openTime: string | null;
  closeTime: string | null;
};

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
  /**
   * IANA zone the store trades in. Munger, Bihar is `Asia/Kolkata`; the store's
   * own column is used so an outlet elsewhere does not need a code change.
   */
  timezone: string;
  /**
   * Per-day timings from `outlet_hours` (Admin > Outlets > Operating Hours).
   * Authoritative for open/closed decisions — `hoursSummary` is owner prose.
   */
  weeklyHours: PublicWeeklyHour[];
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

/** An active, customer-facing FAQ from Admin > Content > FAQs. */
export type PublicFaq = {
  id: number;
  question: string;
  answer: string;
  position: number;
};

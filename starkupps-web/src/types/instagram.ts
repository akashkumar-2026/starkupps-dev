/** Instagram feed domain types served by the public API. */

export type InstagramPostType = "post" | "reel";

export type InstagramScrollSpeed = "slow" | "normal" | "fast";

export type PublicInstagramPost = {
  id: number;
  url: string;
  shortcode: string;
  type: InstagramPostType;
  caption: string | null;
  thumbnailUrl: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type PublicInstagramSettings = {
  enabled: boolean;
  eyebrow: string;
  heading: string;
  subheading: string | null;
  profileHandle: string;
  profileUrl: string;
  followButtonLabel: string;
  scrollSpeed: InstagramScrollSpeed;
  maxItems: number;
  pauseOnHover: boolean;
};

/**
 * Settings and active posts in a single read, so the section never renders
 * with settings from one response and posts from another.
 */
export type PublicInstagramFeed = {
  settings: PublicInstagramSettings | null;
  posts: PublicInstagramPost[];
  /** Seconds for one -50% lap of the duplicated track, computed server-side. */
  durationSeconds: number;
};

/**
 * Rendered metrics for the marquee track.
 *
 * Repeats are deliberately not used to fill the viewport: one post rendered
 * five times reads as a rendering bug, and an operator should see on the site
 * exactly what they set up in Admin.
 */
export type MarqueeMetrics = {
  /** How many times the feed list is repeated in the track. */
  repeats: number;
  /** Cards rendered in one lap = repeats × feed length. Drives the duration. */
  cardsPerLap: number;
};

/**
 * Instagram permalink parsing + normalisation, shared by the Admin panel
 * (live validation while typing, server-side enforcement) and the storefront
 * (embed URL derivation).
 *
 * Deliberate design notes:
 * - No Instagram API is involved anywhere in this feature. We only accept a
 *   permalink the operator already has, and derive an embed URL from it.
 * - `/tv/` (IGTV) is stored as `type: "reel"` because Instagram serves IGTV
 *   from the `/reel/` embed path and redirects `/tv/` → `/reel/`. Keeping one
 *   normalised path segment means a single code path in the card renderer.
 * - Validation is a pure function returning a discriminated result (never
 *   throws) so the Admin "Add post" input can validate on every keystroke
 *   without try/catch noise.
 */

export type InstagramPostType = "post" | "reel";
export type InstagramScrollSpeed = "slow" | "normal" | "fast";

export type InstagramPost = {
  id: number;
  url: string;
  shortcode: string;
  type: InstagramPostType;
  caption: string | null;
  thumbnailUrl: string | null;
  previewVideoUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type InstagramSettings = {
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

/** Public payload shape returned by `/api/public/instagram`. */
export type InstagramFeedPayload = {
  settings: InstagramSettings | null;
  posts: InstagramPost[];
  /** Server-computed seconds for one full -50% marquee lap. */
  durationSeconds: number;
};

export const INSTAGRAM_ORIGIN = "https://www.instagram.com";

// Instagram shortcodes are base64url-ish. Kept permissive (Instagram has
// shipped longer codes over time) but strict enough to reject path traversal,
// whitespace and injected markup before it reaches an href.
const SHORTCODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const HANDLE_PATTERN = /^[a-z0-9._]{1,30}$/;

// Exact-match hosts only. `instagram.com.evil.example` must NOT pass.
const ALLOWED_HOSTS = new Set(["instagram.com", "www.instagram.com"]);

// First path segment → stored post type, and the segment used when rebuilding
// the canonical URL.
const PATH_KINDS: Record<
  string,
  { type: InstagramPostType; segment: "p" | "reel" }
> = {
  p: { type: "post", segment: "p" },
  reel: { type: "reel", segment: "reel" },
  reels: { type: "reel", segment: "reel" },
  tv: { type: "reel", segment: "reel" },
};

export type InstagramUrlParse =
  | { ok: true; shortcode: string; type: InstagramPostType; url: string }
  | { ok: false; error: string };

function toUrl(raw: string): URL | null {
  // Accept scheme-less operator paste ("instagram.com/p/ABC") without ever
  // reaching for `new URL` twice.
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw.replace(/^\/+/, "")}`;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

/**
 * Parse and normalise an Instagram permalink.
 *
 * Accepts, with or without `www`, a query string, a hash fragment, a trailing
 * slash, or extra trailing path segments (share links routinely append
 * `/comments/`):
 *   https://www.instagram.com/p/ABC123/
 *   instagram.com/reel/ABC123/?utm_source=ig_web_copy_link
 *   https://instagram.com/reels/ABC123#comments
 *
 * Normalises every accepted input to
 *   https://www.instagram.com/{p|reel}/{shortcode}/
 */
export function parseInstagramUrl(raw: unknown): InstagramUrlParse {
  if (typeof raw !== "string") {
    return { ok: false, error: "Paste an Instagram post or reel link." };
  }
  const trimmed = raw.trim();
  if (!trimmed)
    return { ok: false, error: "Paste an Instagram post or reel link." };

  const parsed = toUrl(trimmed);
  if (!parsed)
    return { ok: false, error: "That does not look like a valid link." };

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ok: false,
      error: "Only http and https Instagram links are supported.",
    };
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { ok: false, error: "Link must be on instagram.com." };
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const kind = segments[0]?.toLowerCase();
  const matched = kind ? PATH_KINDS[kind] : undefined;
  if (!matched) {
    return {
      ok: false,
      error:
        "Use a post (/p/), reel (/reel/) or IGTV (/tv/) link — not a profile, story or explore link.",
    };
  }

  const shortcode = segments[1];
  if (!shortcode || !SHORTCODE_PATTERN.test(shortcode)) {
    return { ok: false, error: "That link is missing the post code." };
  }

  return {
    ok: true,
    shortcode,
    type: matched.type,
    url: `${INSTAGRAM_ORIGIN}/${matched.segment}/${shortcode}/`,
  };
}

/**
 * Official Instagram embed endpoint. Iframes only — the storefront never loads
 * `embed.js`, which would pull a third-party script into the critical path.
 */
export function instagramEmbedUrl(
  shortcode: string,
  type: InstagramPostType
): string {
  const segment = type === "reel" ? "reel" : "p";
  return `${INSTAGRAM_ORIGIN}/${segment}/${encodeURIComponent(shortcode)}/embed/`;
}

/** Human-facing label for a post type. */
export function instagramTypeLabel(type: InstagramPostType): string {
  return type === "reel" ? "Reel" : "Post";
}

/**
 * Strip C0/C1 control characters and collapse whitespace runs. Used for every
 * free-text field the operator types so nothing unprintable reaches the public
 * site. Returns null for empty input so the column stays NULL, not "".
 */
export function sanitizeText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

/** Always returns a string (falls back to `fallback` when blank/invalid). */
export function sanitizeRequiredText(
  raw: unknown,
  maxLength: number,
  fallback: string
): string {
  const value = sanitizeText(raw, maxLength);
  return value ?? fallback;
}

/** Normalise `@handle` / `starkupps.` / `Stark Upps` → `starkupps`. */
export function sanitizeProfileHandle(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const stripped = raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9._]/g, "");
  return HANDLE_PATTERN.test(stripped) ? stripped : "";
}

/** True when the value is an instagram.com URL (any path). */
export function isInstagramProfileUrl(raw: unknown): boolean {
  if (typeof raw !== "string" || !raw.trim()) return false;
  const parsed = toUrl(raw.trim());
  if (!parsed) return false;
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  return ALLOWED_HOSTS.has(parsed.hostname.toLowerCase());
}

/**
 * Best-effort canonical profile URL. Falls back to the handle-derived URL when
 * the stored value is blank or points somewhere other than instagram.com, so a
 * bad value can never produce an off-site "Follow" link.
 */
export function resolveProfileUrl(
  profileUrl: unknown,
  profileHandle: unknown
): string {
  const handle = sanitizeProfileHandle(profileHandle);
  const fallback = handle
    ? `${INSTAGRAM_ORIGIN}/${handle}/`
    : `${INSTAGRAM_ORIGIN}/`;
  if (typeof profileUrl !== "string" || !profileUrl.trim()) return fallback;
  const parsed = toUrl(profileUrl.trim());
  if (!parsed) return fallback;
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    return fallback;
  if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) return fallback;
  const firstSegment = parsed.pathname.split("/").filter(Boolean)[0];
  if (!firstSegment || !HANDLE_PATTERN.test(firstSegment.toLowerCase())) {
    return fallback;
  }
  return `${INSTAGRAM_ORIGIN}/${firstSegment.toLowerCase()}/`;
}

/**
 * Seconds one card should occupy in the marquee. Duration is derived from the
 * item count so perceived speed stays constant no matter how many posts an
 * operator adds — adding posts makes the track longer and the lap longer, never
 * faster.
 */
export const SCROLL_SECONDS_PER_ITEM: Record<InstagramScrollSpeed, number> = {
  slow: 9,
  normal: 6.5,
  fast: 4,
};

/** Total seconds for one full -50% lap (i.e. one duplicated set). */
export function marqueeDurationSeconds(
  speed: InstagramScrollSpeed,
  itemCount: number
): number {
  const perItem =
    SCROLL_SECONDS_PER_ITEM[speed] ?? SCROLL_SECONDS_PER_ITEM.normal;
  const count = Number.isFinite(itemCount)
    ? Math.max(1, Math.floor(itemCount))
    : 1;
  // Floor at 6s so a single-item track still reads as deliberate motion.
  return Math.max(6, Math.round(count * perItem));
}

export const INSTAGRAM_LIMITS = {
  caption: 500,
  eyebrow: 40,
  heading: 90,
  subheading: 220,
  followButtonLabel: 30,
  maxItems: 30,
  minItems: 1,
} as const;

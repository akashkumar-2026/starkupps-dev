/** Resolve Instagram post/reel cover images to allow-listed Meta CDN URLs. */
const THUMB_TTL_MS = 30 * 60 * 1000;
const THUMB_TIMEOUT_MS = 6000;
const thumbCache = new Map<string, { url: string | null; exp: number }>();
const THUMB_HOST_RE = /(^|\.)(cdninstagram\.com|fba\.net|fbcdn\.net)$/i;

export async function resolveInstagramThumbnail(
  shortcode: string
): Promise<string | null> {
  const cached = thumbCache.get(shortcode);
  if (cached && cached.exp > Date.now()) return cached.url;

  let url: string | null = null;
  try {
    const response = await fetch(
      `https://www.instagram.com/p/${encodeURIComponent(shortcode)}/media/?size=l`,
      {
        redirect: "manual",
        signal: AbortSignal.timeout(THUMB_TIMEOUT_MS),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
        },
      }
    );
    const location = response.headers.get("location");
    if (response.status === 302 && location) {
      const parsed = new URL(location);
      if (parsed.protocol === "https:" && THUMB_HOST_RE.test(parsed.hostname)) {
        url = parsed.toString();
      }
    }
  } catch {
    // Private, removed, or unreachable posts use the card's branded fallback.
  }

  thumbCache.set(shortcode, { url, exp: Date.now() + THUMB_TTL_MS });
  return url;
}

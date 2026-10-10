/**
 * Per-route document metadata.
 *
 * React 19 natively hoists `<title>` and `<meta>` rendered anywhere in the tree
 * into `document.head`, so routes declare their own metadata declaratively
 * without a framework-specific head manager. Baseline tags live in
 * `index.html`; this component only overrides what varies by route.
 */

import { ENV } from "@/config/env";
import { CANONICAL_ORIGIN, canonicalUrl } from "@/config/site";

/**
 * Staging/preview safety: any host other than the canonical one (Vercel
 * previews, the pre-redirect .com mirrors) is never indexable, with no env
 * var or dashboard setting to forget. Loopback (localhost) is exempt — it is
 * unroutable so there is nothing to keep out of any index, and lab tooling
 * (Lighthouse) must measure pages as crawlers see them.
 */
function isOffCanonicalHost(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
      return false;
    return window.location.origin !== CANONICAL_ORIGIN;
  } catch {
    return false;
  }
}

export type PageMeta = {
  /** Page title. The brand suffix is appended automatically. */
  title: string;
  description?: string;
  /** Overrides `title` for Open Graph. Defaults to `title`. */
  ogTitle?: string;
  ogDescription?: string;
  /**
   * Site path for the self-referencing canonical (`"/"` for home,
   * `"/about"` for about). Always pass it on indexable routes so crawlers
   * see exactly one preferred URL per page.
   */
  path?: string;
  /** `true` to keep search engines from indexing utility routes. */
  noIndex?: boolean;
};

const BRAND = "StarKupps";

export function PageMeta({ title, description, ogTitle, ogDescription, path, noIndex }: PageMeta) {
  const fullTitle = title.includes(BRAND) ? title : `${title} — ${BRAND}`;
  // Explicit per-route noindex wins; off-host is the automatic backstop.
  const hidden = noIndex || isOffCanonicalHost();

  return (
    <>
      <title>{fullTitle}</title>
      {description ? <meta name="description" content={description} /> : null}
      {path ? <link rel="canonical" href={canonicalUrl(path)} /> : null}
      {hidden ? <meta name="robots" content="noindex, nofollow" /> : null}
      {ENV.siteVerificationGoogle ? (
        <meta name="google-site-verification" content={ENV.siteVerificationGoogle} />
      ) : null}
      {ENV.siteVerificationBing ? (
        <meta name="msvalidate.01" content={ENV.siteVerificationBing} />
      ) : null}
      <meta property="og:title" content={ogTitle ?? fullTitle} />
      {ogDescription ? <meta property="og:description" content={ogDescription} /> : null}
    </>
  );
}

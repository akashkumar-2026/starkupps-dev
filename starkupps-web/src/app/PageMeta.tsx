/**
 * Per-route document metadata.
 *
 * React 19 natively hoists `<title>` and `<meta>` rendered anywhere in the tree
 * into `document.head`, so routes declare their own metadata declaratively
 * without a framework-specific head manager. Baseline tags live in
 * `index.html`; this component only overrides what varies by route.
 */

import { ENV } from "@/config/env";
import { canonicalUrl } from "@/config/site";

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

  return (
    <>
      <title>{fullTitle}</title>
      {description ? <meta name="description" content={description} /> : null}
      {path ? <link rel="canonical" href={canonicalUrl(path)} /> : null}
      {noIndex ? <meta name="robots" content="noindex, nofollow" /> : null}
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

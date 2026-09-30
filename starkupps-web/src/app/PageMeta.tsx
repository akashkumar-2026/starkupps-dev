/**
 * Per-route document metadata.
 *
 * React 19 natively hoists `<title>` and `<meta>` rendered anywhere in the tree
 * into `document.head`, so routes declare their own metadata declaratively
 * without a framework-specific head manager. Baseline tags live in
 * `index.html`; this component only overrides what varies by route.
 */

export type PageMeta = {
  /** Page title. The brand suffix is appended automatically. */
  title: string;
  description?: string;
  /** Overrides `title` for Open Graph. Defaults to `title`. */
  ogTitle?: string;
  ogDescription?: string;
  /** `true` to keep search engines from indexing utility routes. */
  noIndex?: boolean;
};

const BRAND = "StarKupps";

export function PageMeta({ title, description, ogTitle, ogDescription, noIndex }: PageMeta) {
  const fullTitle = title.includes(BRAND) ? title : `${title} — ${BRAND}`;

  return (
    <>
      <title>{fullTitle}</title>
      {description ? <meta name="description" content={description} /> : null}
      {noIndex ? <meta name="robots" content="noindex, nofollow" /> : null}
      <meta property="og:title" content={ogTitle ?? fullTitle} />
      {ogDescription ? <meta property="og:description" content={ogDescription} /> : null}
    </>
  );
}

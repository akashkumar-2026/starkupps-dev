import { Link } from "@tanstack/react-router";

export type Crumb = { label: string; to?: string };

/**
 * Visible breadcrumb trail (crawler links + a11y), rendered above the H1 on
 * non-home public pages. Mirrors the BreadcrumbList JSON-LD emitted for the
 * same page by the prerender script — add a crumb here and add it there.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        {items.map((crumb, i) => (
          <li key={crumb.label} className="flex items-center gap-1.5">
            {i > 0 && (
              <span aria-hidden="true" className="opacity-60">
                /
              </span>
            )}
            {crumb.to ? (
              <Link to={crumb.to} className="rounded-sm font-medium text-primary hover:underline">
                {crumb.label}
              </Link>
            ) : (
              <span aria-current="page" className="font-medium text-foreground">
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

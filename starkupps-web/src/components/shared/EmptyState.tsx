import { Link } from "@tanstack/react-router";
import { ArrowRight, type LucideIcon } from "lucide-react";

/**
 * Shared empty state. Used wherever a customer-visible list has nothing to
 * show, so the tone stays consistent across menu, orders and addresses.
 */
export function EmptyState({
  title,
  hint,
  cta,
  icon: Icon,
}: {
  title: string;
  hint: string;
  cta?: { label: string; to: string };
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-border bg-card px-6 py-12 text-center shadow-card">
      {Icon ? (
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
          <Icon className="size-6" />
        </div>
      ) : null}
      <p className="mt-4 font-display text-xl">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{hint}</p>
      {cta ? (
        <Link
          to={cta.to}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground"
        >
          {cta.label}
          <ArrowRight className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Route-level error and not-found boundaries.
 *
 * Every failure the customer can reach ends in a recoverable screen rather than
 * a blank page. Errors are reported once per boundary via `reportError`.
 */
import { useEffect } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";

import { reportError } from "@/utils/errors";

const shellClass = "flex min-h-screen items-center justify-center bg-background px-4";
const cardClass = "max-w-md text-center";

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 flex flex-wrap justify-center gap-2">{children}</div>;
}

const primaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90";

const secondaryButtonClass =
  "inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent";

export function NotFound() {
  return (
    <div className={shellClass}>
      <div className={cardClass}>
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Actions>
          <Link to="/" className={primaryButtonClass}>
            Go home
          </Link>
        </Actions>
      </div>
    </div>
  );
}

export function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
  const router = useRouter();

  useEffect(() => {
    reportError(error, { boundary: "route" });
  }, [error]);

  return (
    <div className={shellClass}>
      <div className={cardClass}>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn&apos;t load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <Actions>
          <button
            type="button"
            onClick={() => {
              void router.invalidate();
              reset();
            }}
            className={primaryButtonClass}
          >
            <RefreshCw className="size-4" />
            Try again
          </button>
          <Link to="/" className={secondaryButtonClass}>
            Go home
          </Link>
        </Actions>
      </div>
    </div>
  );
}

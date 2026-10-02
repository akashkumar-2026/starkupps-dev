import { RefreshCw } from "lucide-react";

import { Pressable } from "@/components/shared/Pressable";

/**
 * Real error state with a retry action.
 *
 * Used wherever a live query failed. It deliberately does not describe the
 * failure as temporary or imply that data is on its way — the storefront's
 * previous copy ("Fresh menu on its way", "Menu is taking a moment") read like
 * a pending state, so a hard failure looked identical to a slow load and nobody
 * knew to retry.
 */
export function FetchErrorState({
  title = "We couldn't load this",
  description,
  onRetry,
  retrying = false,
}: {
  title?: string;
  description: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      className="rounded-3xl border border-border bg-card p-8 text-center shadow-card"
    >
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      <div className="mt-5 flex justify-center">
        <Pressable
          onClick={onRetry}
          disabled={retrying}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-chip disabled:opacity-50"
        >
          <RefreshCw className={retrying ? "size-4 animate-spin" : "size-4"} />
          {retrying ? "Retrying" : "Try again"}
        </Pressable>
      </div>
    </div>
  );
}

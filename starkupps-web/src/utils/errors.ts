/**
 * Client error reporting.
 *
 * Single funnel for application errors so swapping in a hosted reporter (Sentry,
 * etc.) is a one-file change. Never sends anything to the network itself — that
 * would be a surprise for a static storefront, and could leak PII in payloads.
 */

export type ErrorSeverity = "error" | "warning" | "info";

export type ReportContext = Record<string, unknown>;

/** Set `VITE_ERROR_REPORTER_DSN` to enable a hosted reporter. */
const REPORTER_ENABLED = false;

export function reportError(
  error: unknown,
  context: ReportContext = {},
  severity: ErrorSeverity = "error",
): void {
  const prefix = `[app:${severity}]`;

  if (severity === "error") {
    if (Object.keys(context).length > 0) console.error(prefix, error, context);
    else console.error(prefix, error);
  } else {
    console.warn(prefix, error, context);
  }

  if (REPORTER_ENABLED) {
    // Intentionally empty: wire a hosted reporter here, e.g.
    // Sentry.captureException(error, { level: severity, extra: context });
  }
}

/** Best-effort message extraction from an unknown thrown value. */
export function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  return undefined;
}

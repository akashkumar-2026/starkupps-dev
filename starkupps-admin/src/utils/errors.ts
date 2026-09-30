const FALLBACK_MESSAGE = "We could not complete that change. Please try again.";

/**
 * Turns anything thrown by a mutation into a message safe to show a user.
 * tRPC exposes server messages on 4xx (actionable), but replaces 5xx detail
 * with a generic string, so an empty message means "something broke".
 */
export function apiError(
  error: unknown,
  fallback: string = FALLBACK_MESSAGE
): string {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string" &&
    (error as { message: string }).message
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

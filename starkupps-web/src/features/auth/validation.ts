/**
 * Auth validation shared by every sign-in surface (login page, sign-up page,
 * the dialog, and the password-reset route) so the rules cannot drift apart.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export type PasswordCheck = { ok: boolean; reason?: string };

/** Password policy: at least 8 characters with at least one letter and one number. */
export function checkPassword(password: string): PasswordCheck {
  if (password.length < 8) return { ok: false, reason: "Use at least 8 characters" };
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return { ok: false, reason: "Include both letters and numbers" };
  }
  return { ok: true };
}

/** Map a GoTrue/Supabase error to a message the customer can act on. */
export function friendlyAuthError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const msg = raw.toLowerCase();

  if (msg.includes("invalid login credentials")) {
    return "Incorrect email or password. Try again or reset your password.";
  }
  if (msg.includes("email not confirmed")) {
    return "Please verify your email first — check your inbox for the confirmation link.";
  }
  if (msg.includes("user already registered") || msg.includes("already been registered")) {
    return "An account with this email already exists. Try signing in instead.";
  }
  if (msg.includes("password should be at least")) {
    return "Password doesn't meet the minimum length. Use at least 8 characters.";
  }
  if (
    msg.includes("for security purposes") ||
    msg.includes("rate limit") ||
    msg.includes("too many")
  ) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (msg.includes("expired") || (msg.includes("invalid") && msg.includes("token"))) {
    return "This link has expired or was already used. Request a fresh one.";
  }
  if (msg.includes("network") || msg.includes("fetch failed") || msg.includes("failed to fetch")) {
    return "Couldn't reach the server. Check your connection and try again.";
  }

  return raw || "Something went wrong. Please try again.";
}

/** Thrown when an auth action is attempted in a build with no Supabase config. */
export function notConfiguredError(): Error {
  return new Error("Auth is not configured. Set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.");
}

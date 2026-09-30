import { ENV } from "../config/env";

// Pluggable email delivery for password reset.
// Priority: 1) RESEND_API_KEY 2) SMTP_URL 3) fallback: log warn (not production ready)
// Returns true if email was sent, false if skipped (still counts as success to avoid enumeration).

export async function sendPasswordResetEmail(
  email: string,
  token: string
): Promise<boolean> {
  const base = ENV.appUrl ?? "http://localhost:5173";
  const resetUrl = `${base.replace(/\/$/, "")}/auth/reset-password?token=${encodeURIComponent(token)}`;
  const subject = "Reset your StarKupps password";
  const text = `You requested a password reset. Use this link within 1 hour:\n${resetUrl}\nIf you didn't request this, ignore it.`;

  // 1) Resend (https://resend.com) - if RESEND_API_KEY set
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM || "StarKupps <noreply@starkupps.com>",
          to: email,
          subject,
          text,
        }),
      });
      if (res.ok) return true;
      console.warn(
        `[mailer] Resend failed ${res.status}: ${await res.text().catch(() => "")}`
      );
    } catch (e) {
      console.warn("[mailer] Resend error", e);
    }
  }

  // 2) Generic SMTP via SMTP_URL (nodemailer would need dep; for now warn)
  if (process.env.SMTP_URL) {
    console.warn(
      "[mailer] SMTP_URL set but nodemailer not installed — skipping. Install nodemailer or set RESEND_API_KEY."
    );
  }

  // 3) Supabase Auth email (if_SUPABASE_URL+SERVICE_ROLE_KEY - can use auth.admin)
  // Supabase Auth password recovery via GoTrue would be ideal if we migrated to Supabase Auth.
  // For custom-table flow we keep our own token; email must be configured externally.

  if (process.env.NODE_ENV === "production") {
    console.warn(
      `[mailer] No email provider configured — password reset email for ${email} NOT sent. Set RESEND_API_KEY to enable.`
    );
    return false;
  }
  // In dev, log token when DEBUG_AUTH_TOKENS=1 already does; still return false to indicate not sent
  if (process.env.DEBUG_AUTH_TOKENS === "1") {
    console.log(`[mailer:dev] Reset link for ${email}: ${resetUrl}`);
  }
  return false;
}

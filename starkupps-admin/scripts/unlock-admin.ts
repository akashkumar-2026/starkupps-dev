/**
 * Unlock / recover an admin account.
 *
 * Login throttling (per-IP, per-account failure budget, progressive delay) is
 * intentionally aggressive. In a panel where only `owner` accounts may sign
 * in, a locked account locks out everyone, and there is no second account able
 * to undo it from the UI. This script is the operator escape hatch.
 *
 * Usage:
 *   npm run auth:unlock -- admin@starkupps.local
 *   npm run auth:unlock -- admin@starkupps.local --all      # also revoke sessions
 *
 * Clears:
 *   - users.failedLoginAttempts / users.lockedUntil
 *   - rate-limit buckets for the account (login:fail:*, login:attempt:*)
 *
 * Optionally (--all) also revokes every device session and bumps
 * users.sessionVersion, which forces a fresh sign-in everywhere. Use this if
 * you suspect the account was compromised.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const email = (process.argv[2] || "").trim().toLowerCase();
const revokeAll = process.argv.includes("--all");

if (!email) {
  console.error("Usage: npm run auth:unlock -- <admin-email> [--all]");
  process.exit(1);
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const { data: user, error } = await supabase
    .from("users")
    .select(
      "id,email,role,status,failedLoginAttempts,lockedUntil,sessionVersion"
    )
    .eq("email", email)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!user) {
    console.error(`No account found for ${email}`);
    process.exit(1);
  }
  const u: any = user;
  console.log(
    `Found ${u.email} (id=${u.id}, role=${u.role}, status=${u.status ?? "ACTIVE"})`
  );
  console.log(
    `  failedLoginAttempts=${u.failedLoginAttempts ?? 0} lockedUntil=${u.lockedUntil ?? "none"}`
  );

  const patch: Record<string, unknown> = {
    failedLoginAttempts: 0,
    lockedUntil: null,
  };
  if (revokeAll) {
    patch.sessionVersion = (u.sessionVersion ?? 0) + 1;
    patch.status = "ACTIVE";
  }

  const { error: upErr } = await supabase
    .from("users")
    .update(patch as any)
    .eq("id", u.id);
  if (upErr) throw upErr;
  console.log("  cleared login lockout");

  // Rate-limit buckets are keyed by the normalized address.
  const keys = [
    `login:fail:acct:${email}`,
    `login:attempt:acct:${email}`,
    `forgot:email:${email}`,
  ];
  const { error: rlErr } = await supabase
    .from("rate_limits")
    .delete()
    .in("key", keys);
  if (rlErr)
    console.warn(`  warning: could not clear rate limits: ${rlErr.message}`);
  else console.log(`  cleared ${keys.length} rate-limit buckets`);

  if (revokeAll) {
    const { error: sErr } = await supabase
      .from("sessions")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_reason: "operator_unlock",
      })
      .eq("user_id", u.id)
      .is("revoked_at", null);
    if (sErr) throw sErr;
    console.log("  revoked all device sessions (everyone must sign in again)");
  }

  console.log("Done. The account can sign in again.");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

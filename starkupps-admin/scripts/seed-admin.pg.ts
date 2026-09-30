/**
 * Seed admin user — Supabase version (no Drizzle)
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed-admin.pg.ts admin@starkupps.local "StrongPass123" "Admin Name"
 *   # Legacy fallback: DATABASE_URL=postgres://... still works via postgres.js
 */
import { createClient } from "@supabase/supabase-js";
import WS from "ws";
import { randomBytes } from "node:crypto";
import { hashPassword, checkPasswordPolicy } from "../server/auth/auth";

// Polyfill WebSocket for Node 20 (Supabase Realtime requires it) — same as server/db/supabase.ts
if (typeof (globalThis as any).WebSocket === "undefined") {
  (globalThis as any).WebSocket = WS;
}

const email = process.argv[2] || "admin@starkupps.local";
const name = process.argv[4] || "StarKupps Admin";

// NO DEFAULT PASSWORD.
//
// This script used to fall back to "Admin12345", so `npm run db:seed` with no
// arguments silently created (or reset) a full `role=admin` account protected
// by a password that is published in this repository. Anyone who has read the
// source could take over the panel.
//
// A strong random password is now generated and printed once, so the operator
// can sign in and then change it from Security -> Change password.
const password = process.argv[3] || randomBytes(12).toString("base64url");

if (!process.argv[3]) {
  console.log(
    "No password supplied — generating a strong random one for this run.\n"
  );
}

const policy = checkPasswordPolicy(password);
if (!policy.ok) {
  console.error(`Password rejected: ${policy.reason}`);
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function mainSupabase() {
  if (!supabaseUrl || !supabaseKey) {
    console.error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required (or DATABASE_URL fallback)"
    );
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });
  const openId = `email:${email.toLowerCase()}`;
  const passwordHash = await hashPassword(password);

  const { data: existing } = await supabase
    .from("users")
    .select("id,openId")
    .eq("email", email)
    .limit(1)
    .maybeSingle();
  if (existing) {
    // NOTE: openId is identity — only rewrite it when it differs, otherwise the
    // unique constraint "users_openId_unique" can 23505 against the row itself.
    const patch: any = { passwordHash, name, role: "admin" };
    if ((existing as any).openId !== openId) patch.openId = openId;
    const { error } = await supabase
      .from("users")
      .update(patch)
      .eq("id", (existing as any).id);
    if (error) throw error;
    console.log(`Updated user ${email} (id=${(existing as any).id})`);
    const { data: s } = await supabase
      .from("staff")
      .select("id")
      .eq("email", email)
      .limit(1)
      .maybeSingle();
    if (!s) {
      const { error: insErr } = await supabase.from("staff").insert({
        email,
        name,
        role: "owner",
        status: "active",
        active: true,
        userId: (existing as any).id,
      } as any);
      if (insErr) throw insErr;
      console.log("Created staff owner record");
    } else {
      const { error: updErr } = await supabase
        .from("staff")
        .update({
          status: "active",
          active: true,
          role: "owner",
          userId: (existing as any).id,
        } as any)
        .eq("id", (s as any).id);
      if (updErr) throw updErr;
      console.log("Updated staff record to owner/active");
    }
  } else {
    const { data: ins, error: insErr } = await supabase
      .from("users")
      .insert({
        openId,
        email,
        name,
        role: "admin",
        passwordHash,
        loginMethod: "password",
      } as any)
      .select("id")
      .single();
    if (insErr) throw insErr;
    const id = Number((ins as any).id);
    console.log(`Created user ${email} (id=${id})`);
    const { error: staffErr } = await supabase.from("staff").insert({
      email,
      name,
      role: "owner",
      status: "active",
      active: true,
      userId: id,
    } as any);
    if (staffErr) throw staffErr;
    console.log("Created staff owner record");
  }
  if (!process.argv[3]) {
    console.log("\n=============================================");
    console.log("  Generated admin password (shown once):");
    console.log(`  ${password}`);
    console.log("  Sign in, then change it under Security.");
    console.log("=============================================\n");
  }
  console.log("Done. You can now login at /auth/login");
}

async function mainPostgresFallback() {
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const openId = `email:${email.toLowerCase()}`;
  const passwordHash = await hashPassword(password);
  const existing =
    await sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
  if (existing[0]) {
    await sql`UPDATE users SET "passwordHash" = ${passwordHash}, name = ${name}, role = 'admin', "openId" = ${openId} WHERE id = ${existing[0].id}`;
    console.log(`Updated user ${email} (id=${existing[0].id})`);
    const s = await sql`SELECT id FROM staff WHERE email = ${email} LIMIT 1`;
    if (!s[0]) {
      await sql`INSERT INTO staff (email, name, role, status, active, "userId") VALUES (${email}, ${name}, 'owner', 'active', true, ${existing[0].id})`;
      console.log("Created staff owner record");
    } else {
      await sql`UPDATE staff SET status='active', active=true, role='owner', "userId"=${existing[0].id} WHERE id=${s[0].id}`;
      console.log("Updated staff record to owner/active");
    }
  } else {
    const ins =
      await sql`INSERT INTO users ("openId", email, name, role, "passwordHash", "loginMethod") VALUES (${openId}, ${email}, ${name}, 'admin', ${passwordHash}, 'password') RETURNING id`;
    const id = Number((ins as any)[0].id);
    console.log(`Created user ${email} (id=${id})`);
    await sql`INSERT INTO staff (email, name, role, status, active, "userId") VALUES (${email}, ${name}, 'owner', 'active', true, ${id})`;
    console.log("Created staff owner record");
  }
  if (!process.argv[3]) {
    console.log("\n=============================================");
    console.log("  Generated admin password (shown once):");
    console.log(`  ${password}`);
    console.log("  Sign in, then change it under Security.");
    console.log("=============================================\n");
  }
  console.log("Done. You can now login at /auth/login");
  await sql.end();
}

(supabaseUrl && supabaseKey ? mainSupabase() : mainPostgresFallback()).catch(
  e => {
    console.error(e);
    process.exit(1);
  }
);

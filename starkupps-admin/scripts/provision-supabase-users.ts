#!/usr/bin/env tsx
/**
 * Production-grade Supabase user provisioning
 * - Validates Supabase Management API token from starkupps-access-token-key.txt
 * - Verifies project health (ACTIVE_HEALTHY)
 * - Creates/updates two users idempotently: Starkupps Admin (owner) & Starkupps POS Testing User (staff)
 * - Uses scrypt password hashing (same as server/auth/auth.ts), secure random passwords
 * - Transactional via postgres (DIRECT_URL) with supabase-js fallback
 * - Links users -> staff -> outlet_staff, records audit_log
 * - Verifies passwords post-creation
 *
 * Usage:
 *   npx tsx scripts/provision-supabase-users.ts
 *   npx tsx scripts/provision-supabase-users.ts --admin-email admin@starkupps.local --admin-pass '...' --pos-email pos.testing@starkupps.local --pos-pass '...'
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Load env from starkupps-admin/.env and root .env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "njqrcxtjzghlyrmgsrmq";
const SUPABASE_URL =
  process.env.SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
const TOKEN_PATH = path.resolve(
  __dirname,
  "../../starkupps-access-token-key.txt"
);

// Target users (override via CLI)
const args = process.argv.slice(2);
function argVal(flag: string, fallback: string): string {
  const i = args.indexOf(flag);
  if (i !== -1 && args[i + 1]) return args[i + 1];
  return fallback;
}

const ADMIN_EMAIL = argVal("--admin-email", "admin@starkupps.local");
const ADMIN_NAME = argVal("--admin-name", "Starkupps Admin");
const POS_EMAIL = argVal("--pos-email", "pos.testing@starkupps.local");
const POS_NAME = argVal("--pos-name", "Starkupps POS - Testing User");

// If passwords not supplied, generate secure ones
function generateSecurePassword(len = 20): string {
  // Ensure complexity: upper, lower, digits, symbols
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const symbols = "!@#$%^&*_-+=";
  const all = upper + lower + digits + symbols;
  const pick = (charset: string) => charset[randomBytes(1)[0] % charset.length];
  let pwd = pick(upper) + pick(lower) + pick(digits) + pick(symbols);
  for (let i = 4; i < len; i++) pwd += pick(all);
  // shuffle
  const arr = pwd.split("");
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join("");
}

const ADMIN_PASSWORD = argVal("--admin-pass", "") || generateSecurePassword(20);
const POS_PASSWORD = argVal("--pos-pass", "") || generateSecurePassword(20);

// ---------------------------------------------------------------------------
// Helpers – same scrypt as server/auth/auth.ts
// ---------------------------------------------------------------------------
const SCRYPT_KEYLEN = 64;
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt:${salt}:${derived}`;
}
function verifyPassword(password: string, stored: string): boolean {
  try {
    const [algo, salt, hash] = stored.split(":");
    if (algo !== "scrypt" || !salt || !hash) return false;
    const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(derived, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 1. Validate Management API token (sbp_...)
// ---------------------------------------------------------------------------
async function validateManagementToken(): Promise<void> {
  if (!fs.existsSync(TOKEN_PATH))
    throw new Error(`Token file not found: ${TOKEN_PATH}`);
  const token = fs.readFileSync(TOKEN_PATH, "utf8").trim();
  if (!token.startsWith("sbp_"))
    throw new Error("Invalid Supabase access token prefix (expected sbp_...)");
  console.log(
    `[1/6] Validating Management API token (${token.slice(0, 10)}... len=${token.length})`
  );
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Management API validation failed (${res.status}): ${body}`
    );
  }
  const proj = (await res.json()) as any;
  console.log(
    `      Project: ${proj.name} (${proj.ref}) region=${proj.region} status=${proj.status}`
  );
  if (proj.status !== "ACTIVE_HEALTHY")
    console.warn(
      `      Warning: project status is ${proj.status}, expected ACTIVE_HEALTHY`
    );
  console.log("      ✓ Management API token valid");
}

// ---------------------------------------------------------------------------
// 2. Provision via postgres (preferred) or Supabase REST
// ---------------------------------------------------------------------------
async function provisionViaPostgres(): Promise<void> {
  // Dynamic import to avoid hard dep if postgres missing
  let postgres: any;
  try {
    // Try to resolve from this project's node_modules
    const modPath = path.resolve(
      __dirname,
      "../node_modules/postgres/cjs/src/index.js"
    );
    const mod = await import(modPath);
    postgres = (mod as any).default ?? (mod as any);
    if (typeof postgres !== "function")
      postgres = (mod as any).default || (mod as any).postgres || mod;
    // Fallback to regular import
    if (typeof postgres !== "function") {
      const m2: any = await import("postgres");
      postgres = m2.default ?? m2;
    }
  } catch {
    const m: any = await import("postgres");
    postgres = m.default ?? m;
  }

  const url = DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL / DIRECT_URL not set");

  console.log(`[2/6] Connecting to Postgres (direct) ...`);
  // Use DIRECT_URL (5432) for transactional DDL; strip pgbouncer param if present
  const cleanUrl = url.replace("?pgbouncer=true", "");
  const sql = postgres(cleanUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 15,
    idle_timeout: 10,
  });

  try {
    // Verify connectivity
    await sql`SELECT 1 as ok`;
    console.log("      ✓ Postgres connection ok");

    // Fetch existing outlets for assignment
    const outlets =
      await sql`SELECT id, code, name FROM outlets ORDER BY id LIMIT 5`;
    const defaultOutletId = outlets[0]?.id ?? null;
    console.log(
      `      Outlets: ${outlets.map((o: any) => `${o.id}:${o.code}`).join(", ") || "none"}`
    );

    const usersToProvision = [
      {
        email: ADMIN_EMAIL,
        name: ADMIN_NAME,
        password: ADMIN_PASSWORD,
        usersRole: "admin" as const,
        staffRole: "owner" as const,
        outletIds: null as number[] | null, // null => global (owner)
      },
      {
        email: POS_EMAIL,
        name: POS_NAME,
        password: POS_PASSWORD,
        usersRole: "user" as const,
        staffRole: "staff" as const,
        outletIds: defaultOutletId ? [defaultOutletId] : null,
      },
    ];

    for (const u of usersToProvision) {
      console.log(`\n[3/6] Provisioning ${u.email} (${u.staffRole}) ...`);

      if (u.password.length < 8)
        throw new Error(
          `Password for ${u.email} too short (<8 chars) - minimum 8 required`
        );
      if (u.password.length < 12)
        console.warn(
          `      ⚠ Password for ${u.email} is <12 chars - allowed because explicitly requested, but recommend 12+ for production`
        );

      const openId = `email:${u.email.toLowerCase()}`;
      const passwordHash = hashPassword(u.password);

      // Transaction: upsert users, staff, outlet_staff, audit
      await sql.begin(async (tx: any) => {
        // 1. Upsert users by email OR openId (unique on openId, but email may be separate)
        const existingUser =
          await tx`SELECT id, email, "openId", role FROM users WHERE email = ${u.email} OR "openId" = ${openId} LIMIT 1`;
        let userId: number;
        if (existingUser[0]) {
          userId = Number(existingUser[0].id);
          await tx`UPDATE users SET "openId" = ${openId}, name = ${u.name}, email = ${u.email}, role = ${u.usersRole}, "passwordHash" = ${passwordHash}, "loginMethod" = 'password', "updatedAt" = now(), "failedLoginAttempts" = 0, "lockedUntil" = NULL WHERE id = ${userId}`;
          console.log(`      Updated users.id=${userId} (role=${u.usersRole})`);
        } else {
          const ins =
            await tx`INSERT INTO users ("openId", email, name, role, "passwordHash", "loginMethod", "createdAt", "updatedAt", "lastSignedIn") VALUES (${openId}, ${u.email}, ${u.name}, ${u.usersRole}, ${passwordHash}, 'password', now(), now(), now()) RETURNING id`;
          userId = Number(ins[0].id);
          console.log(`      Created users.id=${userId} (role=${u.usersRole})`);
        }

        // 2. Upsert staff by email
        const existingStaff =
          await tx`SELECT id, "userId", email, role FROM staff WHERE email = ${u.email} LIMIT 1`;
        let staffId: number;
        if (existingStaff[0]) {
          staffId = Number(existingStaff[0].id);
          await tx`UPDATE staff SET "userId" = ${userId}, name = ${u.name}, role = ${u.staffRole}, status = 'active', active = true, "updatedAt" = now() WHERE id = ${staffId}`;
          console.log(
            `      Updated staff.id=${staffId} (role=${u.staffRole}, userId=${userId})`
          );
        } else {
          const sIns =
            await tx`INSERT INTO staff (email, name, role, status, active, "userId", "createdAt", "updatedAt") VALUES (${u.email}, ${u.name}, ${u.staffRole}, 'active', true, ${userId}, now(), now()) RETURNING id`;
          staffId = Number(sIns[0].id);
          console.log(
            `      Created staff.id=${staffId} (role=${u.staffRole}, userId=${userId})`
          );
        }

        // 3. Handle outlet assignment for non-owner (staff)
        if (u.outletIds && u.outletIds.length) {
          for (const oid of u.outletIds) {
            const exists =
              await tx`SELECT id FROM outlet_staff WHERE "outletId" = ${oid} AND "staffId" = ${staffId} LIMIT 1`;
            if (!exists[0]) {
              await tx`INSERT INTO outlet_staff ("outletId", "staffId") VALUES (${oid}, ${staffId})`;
              console.log(
                `      Assigned outlet_staff outletId=${oid} staffId=${staffId}`
              );
            }
          }
        }

        // 4. Audit log (best-effort)
        try {
          await tx`INSERT INTO audit_log ("actorUserId", "entityType", "entityId", "action", "after", "createdAt") VALUES (${userId}, 'user', ${userId}, 'provisioned', ${JSON.stringify({ email: u.email, role: u.usersRole, staffRole: u.staffRole })}::jsonb, now())`;
        } catch (e) {
          console.warn(`      Audit log insert warn: ${(e as any)?.message}`);
        }
      });

      // Post-transaction verification: fetch and verify password
      const verifyRow =
        await sql`SELECT "passwordHash" FROM users WHERE email = ${u.email} LIMIT 1`;
      const stored = verifyRow[0]?.passwordHash as string;
      if (!stored || !verifyPassword(u.password, stored)) {
        throw new Error(`Password verification failed for ${u.email}`);
      }
      console.log(`      ✓ Password verified (scrypt)`);
    }

    // Cleanup orphan check: staff id 3 previously orphaned
    const orphanCheck =
      await sql`SELECT s.id, s.email, s."userId", u.id as uid FROM staff s LEFT JOIN users u ON u.id = s."userId" WHERE u.id IS NULL`;
    if (orphanCheck.length) {
      console.log(
        `\n      Orphan staff check: ${orphanCheck.length} orphan(s) remaining (will be fixed by above upserts)`
      );
      for (const o of orphanCheck)
        console.log(
          `        staff.id=${o.id} email=${o.email} userId=${o.userId} -> orphan`
        );
    }

    // Final verification summary
    console.log(`\n[4/6] Final state:`);
    const finalUsers =
      await sql`SELECT id, email, name, role, "openId" FROM users ORDER BY id`;
    console.table(finalUsers);
    const finalStaff =
      await sql`SELECT id, email, name, role, status, active, "userId" FROM staff ORDER BY id`;
    console.table(finalStaff);
    const finalOutletStaff =
      await sql`SELECT "outletId", "staffId" FROM outlet_staff ORDER BY "staffId"`;
    console.table(finalOutletStaff);
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}

async function provisionViaSupabaseRest(): Promise<void> {
  const { createClient } = await import("@supabase/supabase-js");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
    throw new Error("SUPABASE_URL / SERVICE_ROLE_KEY missing");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  console.log(`[2/6] (fallback) Using Supabase REST ...`);

  const items = [
    {
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      password: ADMIN_PASSWORD,
      usersRole: "admin" as const,
      staffRole: "owner" as const,
    },
    {
      email: POS_EMAIL,
      name: POS_NAME,
      password: POS_PASSWORD,
      usersRole: "user" as const,
      staffRole: "staff" as const,
    },
  ];

  for (const u of items) {
    console.log(`\n[3/6] Provisioning ${u.email} via REST ...`);
    const openId = `email:${u.email.toLowerCase()}`;
    const passwordHash = hashPassword(u.password);

    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", u.email)
      .limit(1)
      .maybeSingle();
    let userId: number;
    if (existing) {
      userId = (existing as any).id;
      const { error } = await supabase
        .from("users")
        .update({
          openId,
          name: u.name,
          role: u.usersRole,
          passwordHash,
          loginMethod: "password",
        } as any)
        .eq("id", userId);
      if (error) throw error;
      console.log(`      Updated users.id=${userId}`);
    } else {
      const { data: ins, error } = await supabase
        .from("users")
        .insert({
          openId,
          email: u.email,
          name: u.name,
          role: u.usersRole,
          passwordHash,
          loginMethod: "password",
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      userId = Number((ins as any).id);
      console.log(`      Created users.id=${userId}`);
    }

    const { data: staffExisting } = await supabase
      .from("staff")
      .select("id")
      .eq("email", u.email)
      .limit(1)
      .maybeSingle();
    if (staffExisting) {
      const { error } = await supabase
        .from("staff")
        .update({
          userId,
          name: u.name,
          role: u.staffRole,
          status: "active",
          active: true,
        } as any)
        .eq("id", (staffExisting as any).id);
      if (error) throw error;
      console.log(`      Updated staff.id=${(staffExisting as any).id}`);
    } else {
      const { error } = await supabase.from("staff").insert({
        email: u.email,
        name: u.name,
        role: u.staffRole,
        status: "active",
        active: true,
        userId,
      } as any);
      if (error) throw error;
      console.log(`      Created staff for ${u.email}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(
    "=== Starkupps Supabase User Provisioning (Production-grade) ==="
  );
  console.log(`Project: ${PROJECT_REF} @ ${SUPABASE_URL}`);
  console.log(
    `Admin: ${ADMIN_EMAIL} (${ADMIN_NAME}) -> role admin / staff owner`
  );
  console.log(`POS  : ${POS_EMAIL} (${POS_NAME}) -> role user / staff staff`);

  await validateManagementToken();

  // Prefer the postgres transactional path, which can roll back cleanly.
  try {
    await provisionViaPostgres();
  } catch (e) {
    console.warn(`Postgres provisioning failed: ${(e as any)?.message}`);
    console.warn("Falling back to Supabase REST ...");
    await provisionViaSupabaseRest();
  }

  // Write credentials to gitignored file with restricted perms
  const credsPath = path.resolve(
    __dirname,
    "../../.provisioned-credentials.json"
  );
  const creds = {
    provisionedAt: new Date().toISOString(),
    projectRef: PROJECT_REF,
    supabaseUrl: SUPABASE_URL,
    users: [
      {
        email: ADMIN_EMAIL,
        name: ADMIN_NAME,
        role: "admin",
        staffRole: "owner",
        password: ADMIN_PASSWORD,
        loginUrl: "/auth/login",
      },
      {
        email: POS_EMAIL,
        name: POS_NAME,
        role: "user",
        staffRole: "staff",
        password: POS_PASSWORD,
        loginUrl: "/auth/login",
      },
    ],
    notes: "Store securely. File is gitignored. Rotate after sharing.",
  };
  fs.writeFileSync(credsPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
  console.log(
    `\n[5/6] Credentials written to ${credsPath} (mode 600, gitignored)`
  );

  // Summary (mask passwords in terminal except last 4)
  console.log("\n[6/6] Summary:");
  for (const u of creds.users) {
    const masked =
      u.password.slice(0, 2) +
      "*".repeat(Math.max(0, u.password.length - 6)) +
      u.password.slice(-4);
    console.log(
      `  - ${u.email} (${u.staffRole}) id provisioned | password: ${masked} (full in ${path.basename(credsPath)})`
    );
  }
  console.log(
    `\nNext: test login via POST ${SUPABASE_URL}/auth/v1/token or app login at ${creds.users[0].loginUrl}`
  );
  console.log("Done. Rotate credentials after distributing.");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

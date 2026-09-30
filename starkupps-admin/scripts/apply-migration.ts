#!/usr/bin/env tsx
/**
 * Applies one SQL migration file to Supabase and records it in
 * `supabase_migrations.schema_migrations`, so it is not re-applied.
 *
 * Prefer `npm run supabase:push` for normal use. This exists for hosts where
 * the Supabase CLI cannot reach the project.
 *
 * Usage: npm run db:migrate -- supabase/migrations/<version>_<name>.sql
 */
import "dotenv/config";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const file = process.argv[2];
if (!file) {
  console.error(
    "Usage: npm run db:migrate -- supabase/migrations/<version>_<name>.sql"
  );
  process.exit(1);
}

/**
 * Supabase derives the migration version from the numeric prefix of the file
 * name (`20260101120000_add_widgets.sql` -> `20260101120000`).
 */
const name = path.basename(file).replace(/\.sql$/, "");
const version = name.split("_")[0];
if (!/^\d{6,}$/.test(version)) {
  console.error(
    `Cannot read a migration version from "${name}". Expected a numeric prefix, e.g. 20260101120000_add_widgets.sql`
  );
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set — add it to .env before migrating.");
  process.exit(1);
}

const ddl = readFileSync(file, "utf8");
const checksum = createHash("sha256").update(ddl).digest("hex").slice(0, 32);

const sql = postgres(connectionString, {
  ssl: "require",
  max: 1,
  connect_timeout: 15,
});

try {
  const existing = await sql.unsafe(
    "select version from supabase_migrations.schema_migrations where version = $1",
    [version]
  );
  if (existing.length > 0) {
    console.log(`Already applied: ${version} (${name})`);
  } else {
    // DDL and its ledger row commit together, so a crash cannot leave a
    // migration marked as applied when it was not.
    await sql.begin(async tx => {
      await tx.unsafe(ddl);
      await tx.unsafe(
        "insert into supabase_migrations.schema_migrations(version, statements, name) values ($1, $2, $3)",
        [version, [ddl], name || checksum]
      );
    });
    console.log(`APPLIED: ${version} (${name})`);
  }
} catch (error) {
  console.error("FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}

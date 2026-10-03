/**
 * Stubs the `argon2` native binding.
 *
 * ## Why this exists
 *
 * `argon2` ships a prebuilt `.node` binary that **segfaults** on this Node build
 * (v20.20.2 / glibc, `node -e "require('argon2')"` exits 139 with a core dump).
 * That is pre-existing and unrelated to application logic — but it makes any
 * script that transitively imports `server/auth/auth.ts` unrunnable.
 *
 * The import chain is:
 *
 *   publicRouter → auth/rate-limit → (re-export) auth/auth → argon2
 *
 * and that last line is a `export { checkRateLimit } from "./auth"` re-export, so
 * merely loading the rate limiter pulls in the native module.
 *
 * This loader resolves `argon2` to a pure-JS stub instead. Verification scripts
 * that exercise order persistence never hash a password, so a stub is sufficient
 * — and it lets `scripts/verify-ordering.ts` run the *real* router code against
 * the *real* database rather than a hand-copied reimplementation of the SQL.
 *
 * Registered via `--import`, not imported from the script, because the hook must
 * be installed before resolution begins.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(
  pathToFileURL(new URL("./argon2-stub-loader.mjs", import.meta.url).pathname)
);

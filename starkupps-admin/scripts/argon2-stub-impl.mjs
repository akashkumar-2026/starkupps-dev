/**
 * Pure-JS stand-in for the `argon2` native binding.
 *
 * Loaded only by `scripts/argon2-stub-loader.mjs`, and only for verification
 * scripts. Replaces the `.node` binary that segfaults on this build.
 *
 * The exports mirror `argon2`'s public surface so importing modules type-check
 * and run unchanged. `hash` and `verify` are **deliberately fake**: any script
 * using this must not depend on real password hashing. Verification here only
 * touches order persistence and pricing.
 */

const encoder = new TextEncoder();

/** Deterministic, obviously-not-a-real-hash PHC-shaped string. */
export async function hash(password) {
  const bytes = encoder.encode(String(password));
  let sum = 0;
  for (const byte of bytes) sum = (sum * 31 + byte) % 0xffffff;
  return `$argon2id$v=19$m=65536,t=3,p=4$U3R1YnN0Y2NhbA$${sum
    .toString(16)
    .padStart(6, "0")}STUBSTUBSTUBSTUB`;
}

export async function verify(digest, password) {
  // Recomputes the stub digest. A real stored (argon2/scrypt) digest will not
  // match, which is the correct outcome: the stub cannot verify real hashes.
  return String(digest).endsWith((await hash(password)).split("$").pop());
}

/** The library's own constants, mirrored so `argon2.argon2id` resolves. */
export const argon2i = 1;
export const argon2d = 2;
export const argon2id = 2;

export const defaults = { type: argon2id };

export default { hash, verify, argon2i, argon2d, argon2id, defaults };

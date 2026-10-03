/**
 * ESM resolve hook that redirects `argon2` to a pure-JS stub.
 *
 * Paired with `scripts/argon2-stub.mjs`, which registers this hook via
 * `--import`. See that file for why the stub is necessary at all.
 *
 * This is verification-only scaffolding. It is never loaded by the server
 * (`npm run dev:server` / `npm start`) — production resolves the real native
 * binding, which works on the deployed runtime.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "argon2") {
    return {
      url: new URL("./argon2-stub-impl.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}

/**
 * Typed access to Vite's build-time environment.
 *
 * This is the only module in `src/` allowed to touch `import.meta.env`. Every
 * `VITE_`-prefixed value is inlined into the public bundle, so a secret must
 * never be added here — server secrets belong in `server/config/env.ts`.
 */

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const env = {
  /** Dev-server proxy target for `/api`. Not used in production. */
  devApiProxy:
    optional(import.meta.env.VITE_DEV_API_PROXY) ?? "http://localhost:3000",
  /** Port the dev server listens on. */
  port: Number(import.meta.env.VITE_PORT ?? 5173),
  /** Port `vite preview` listens on. */
  previewPort: Number(import.meta.env.VITE_PREVIEW_PORT ?? 4173),
  /** Browser-restricted Google Maps key. Absent disables the map widgets. */
  googleMapsApiKey: optional(import.meta.env.VITE_GOOGLE_MAPS_API_KEY),
  /** Optional Cloud-based map styling id for Google Maps. */
  googleMapsMapId: optional(import.meta.env.VITE_GOOGLE_MAPS_MAP_ID),
  /** Where the sign-out flow sends the browser. */
  loginUrl: optional(import.meta.env.VITE_LOGIN_URL) ?? "/auth/login",
  /** Google Maps is only wired up when a key is present. */
  get mapsEnabled(): boolean {
    return Boolean(this.googleMapsApiKey);
  },
} as const;

export type Env = typeof env;

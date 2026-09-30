/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dev-server proxy target for `/api` requests. */
  readonly VITE_DEV_API_PROXY?: string;
  /** Port the Vite dev server binds to. */
  readonly VITE_PORT?: string;
  /** Port `vite preview` binds to. */
  readonly VITE_PREVIEW_PORT?: string;
  /** Browser-restricted Google Maps JavaScript API key. */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  /** Optional Google Maps Cloud styling map id. */
  readonly VITE_GOOGLE_MAPS_MAP_ID?: string;
  /** Path the sign-out flow redirects to. */
  readonly VITE_LOGIN_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

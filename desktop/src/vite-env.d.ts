/// <reference types="vite/client" />

// Typed env vars Junior reads at build time. `vite/client` already declares the
// built-in flags (DEV, PROD, MODE); this only adds our custom keys so tsc and
// editors know about them.
interface ImportMetaEnv {
  /** Override the Junior Backend base URL. Set to point dev/staging builds at a
   *  tunnel or alternate API. When unset, DEV → localhost:8000, PROD →
   *  https://api.jnremployee.com (see src/lib/backend.ts). */
  readonly VITE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

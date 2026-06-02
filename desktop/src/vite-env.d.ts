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

// Asset-as-URL imports — Vite turns the import path into a bundled URL string
// at build time. vite/client covers common types; we add explicit declarations
// for video formats used by the Splash intro (Seedance mp4) so tsc accepts
// `import introVideo from "./intro.mp4"`.
declare module "*.mp4" {
  const src: string;
  export default src;
}
declare module "*.webm" {
  const src: string;
  export default src;
}

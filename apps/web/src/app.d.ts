/// <reference types="astro/client" />

// The Workers runtime types are imported where they are used (`@cloudflare/workers-types` as a
// module), not loaded as globals: as globals they replace `Request` and `Response` for every
// workspace package this app compiles, and `@dose/api` no longer typechecks against them.

declare module 'cloudflare:workers' {
  /** The Worker's bindings and variables (wrangler.jsonc). */
  export const env: import('./env').WorkerEnv;
}

declare namespace App {
  interface Locals {
    /** The page's language, from the first path segment (`/ar/...`, `/en/...`); null elsewhere. */
    lang: import('@dose/contract').Lang | null;
    /** `rtl` for Arabic, `ltr` otherwise. */
    dir: 'rtl' | 'ltr';
  }
}

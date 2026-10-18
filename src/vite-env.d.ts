/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL, such as https://abcd.supabase.co. Unset means preview mode. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon (publishable) key. Safe in the browser; row level security protects the data. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Parent domain shared by every ELUM service, such as .elum.example. Shares one sign-in across them. */
  readonly VITE_ELUM_COOKIE_DOMAIN?: string;
  /** The domain Type addresses live on (elum.config type_domain). Defaults to type.elum.example. */
  readonly VITE_ELUM_TYPE_DOMAIN?: string;
  /** Where Write is hosted, for the app switcher. */
  readonly VITE_ELUM_WRITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

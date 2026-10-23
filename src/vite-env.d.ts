/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL, such as https://abcd.supabase.co. Unset means preview mode. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon (publishable) key. Safe in the browser; row level security protects the data. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Parent domain shared by every ELUM service, such as .elum.services. Shares one sign-in across them. */
  readonly VITE_ELUM_COOKIE_DOMAIN?: string;
  /** The domain Type addresses live on (elum.config type_domain). Defaults to type.elum.services. */
  readonly VITE_ELUM_TYPE_DOMAIN?: string;
  /** Where Write is hosted. Defaults to https://writebyelum.netlify.app */
  readonly VITE_ELUM_WRITE_URL?: string;
  /** Where Type itself is hosted. Defaults to https://typebyelum.netlify.app */
  readonly VITE_ELUM_TYPE_URL?: string;
  readonly VITE_ELUM_MAKE_URL?: string;
  readonly VITE_ELUM_BROWSE_URL?: string;
  /** Where ELUM Store is hosted. Defaults to https://storebyelum.netlify.app. */
  readonly VITE_ELUM_STORE_URL?: string;
  /** ELUM Account (such as https://accountsbyelum.netlify.app). Set it to sign in through Accounts. */
  readonly VITE_ELUM_ACCOUNT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

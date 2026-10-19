import { api } from '../api';

/**
 * The other ELUM apps, and getting to them signed in. Each app is its own site
 * (elum<app>.netlify.app), so they cannot share a cookie: ELUM Account hands the sign-in over
 * (see ELUMAccountsV1 docs/SIGN-IN.md).
 */
const env = import.meta.env;
const clean = (v: string | undefined) => (v?.trim() ? v.trim().replace(/\/+$/, '') : null);

/** ELUM Account. Set VITE_ELUM_ACCOUNT_URL to sign in through it; unset, Type keeps its own sign-in. */
export const ACCOUNT_URL = clean(env.VITE_ELUM_ACCOUNT_URL);
export const WRITE_URL = clean(env.VITE_ELUM_WRITE_URL) ?? 'https://elumwrite.netlify.app';
export const TYPE_URL = clean(env.VITE_ELUM_TYPE_URL) ?? 'https://elumtype.netlify.app';
/** Where ELUM Account lives, for the launcher, even when sign-in does not go through it. */
export const ACCOUNT_HOME = ACCOUNT_URL ?? 'https://elumaccounts.netlify.app';
export const MAKE_URL = clean(env.VITE_ELUM_MAKE_URL) ?? 'https://elummake.netlify.app';

/** Signing in goes through ELUM Account when it is configured and Supabase is connected. */
export const accountsSignIn = !!ACCOUNT_URL && api.mode === 'remote';

const ELUM_ORIGINS = [ACCOUNT_URL, WRITE_URL, TYPE_URL, MAKE_URL].filter(Boolean).map((u) => new URL(u!).origin);
const TRIED = 'elum.handoff.tried';

/** Sends a signed-out visitor to ELUM Account, which sends them back signed in to `next`. */
export function signInThroughAccount(next: string) {
  // Once a minute at most, so a failing handoff never loops.
  try {
    const last = Number(sessionStorage.getItem(TRIED) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(TRIED, String(Date.now()));
  } catch {
    // Without storage, still try once.
  }
  const query = new URLSearchParams({ to: `${location.origin}/auth/handoff`, next });
  window.location.assign(`${ACCOUNT_URL}/continue?${query.toString()}`);
  return true;
}

/**
 * Opens a link in another ELUM app already signed in: Write documents (/d/<id>), the account
 * pages, Type threads. Other links open as they are.
 */
export async function openElsewhere(href: string, newTab = false) {
  let url: URL;
  try {
    url = new URL(href, location.href);
  } catch {
    return;
  }
  const go = (target: string) => (newTab ? window.open(target, '_blank', 'noopener') : window.location.assign(target));
  if (api.mode !== 'remote' || !ELUM_ORIGINS.includes(url.origin) || url.origin === location.origin) {
    go(url.toString());
    return;
  }
  // Open the tab first (browsers block pop-ups opened after waiting), then send it on.
  const tab = newTab ? window.open('about:blank', '_blank') : null;
  try {
    const target = await api.handoff(`${url.origin}/auth/handoff`, url.pathname + url.search);
    if (tab) tab.location.href = target;
    else window.location.assign(target);
  } catch {
    if (tab) tab.location.href = url.toString();
    else window.location.assign(url.toString());
  }
}

export function openAccount(path = '/') {
  if (ACCOUNT_URL) void openElsewhere(`${ACCOUNT_URL}${path}`, true);
}

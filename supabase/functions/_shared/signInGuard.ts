/**
 * Sign-in links never work from Type. An email that approves a sign-in, signs someone in, or
 * carries a sign-in token arrives as usual, but its links are taken out before it is stored and
 * again before it is shown. Someone who gets into a Type mailbox therefore cannot use it to approve
 * their own sign-in elsewhere, or to sign in to the account with a link from it.
 *
 * The same file is in supabase/functions/_shared/signInGuard.ts, for type-inbound. Plain
 * TypeScript, no DOM, so it runs in both places.
 */

export const REMOVED = 'link removed by Type for your safety';

/** ELUM Account's own sites, previews included. */
const ACCOUNT_HOST = /^(?:(?:[a-z0-9-]+--)?(?:accountbyelum|accountsbyelum|elumaccounts)\.netlify\.app|account\.elum\.space)$/i;

/** True for a link that approves a sign-in, signs someone in, or carries a sign-in token. */
export function isSignInLink(href: string): boolean {
  let u: URL;
  try {
    u = new URL(href.trim().replace(/&amp;/g, '&'));
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const tail = `${u.search}${u.hash}`;
  if (ACCOUNT_HOST.test(u.hostname) && /^\/(approve|auth\/|signin|sign-in|verify)/i.test(u.pathname)) return true;
  if (/\.supabase\.(co|in)$/i.test(u.hostname) && /^\/auth\/v1\//i.test(u.pathname)) return true;
  if (/\/auth\/(handoff|callback|confirm)\/?$/i.test(u.pathname) && /(token|code)/i.test(tail)) return true;
  if (/[#?&](token_hash|access_token|refresh_token|confirmation_token)=/i.test(tail)) return true;
  return false;
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi;

/** Plain text with sign-in links replaced. */
export function guardText(text: string): { text: string; removed: number } {
  let removed = 0;
  const out = text.replace(URL_IN_TEXT, (url) => {
    if (!isSignInLink(url)) return url;
    removed++;
    return `[${REMOVED}]`;
  });
  return { text: out, removed };
}

/**
 * HTML with sign-in links taken out: the link keeps its words but no longer goes anywhere, and a
 * sign-in address written out as text is replaced. Tags are left alone otherwise.
 */
export function guardHtml(html: string): { html: string; removed: number } {
  let removed = 0;
  // Links: <a ... href="..."> ... </a>, with any quoting.
  let out = html.replace(/<a\b([^>]*?)\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))([^>]*)>([\s\S]*?)<\/a\s*>/gi, (whole, _pre, _q, dq, sq, bare, _post, inner) => {
    const href = dq ?? sq ?? bare ?? '';
    if (!isSignInLink(href)) return whole;
    removed++;
    return `<span data-type-guard="removed" style="text-decoration:line-through;opacity:.6">${inner}</span> <em data-type-guard="note">(${REMOVED})</em>`;
  });
  // Addresses written as text, outside tags.
  out = out
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith('<')) return part;
      const g = guardText(part);
      removed += g.removed;
      return g.text;
    })
    .join('');
  return { html: out, removed };
}

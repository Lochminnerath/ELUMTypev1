import DOMPurify from 'dompurify';

/**
 * Received HTML is never trusted (handoff 8.6): it is sanitised here, again, even though
 * type-inbound already cleaned it, and then shown in a sandboxed frame without scripts.
 * Remote images (tracking pixels) stay blocked until the person allows them.
 */

export interface CleanEmail {
  html: string;
  /** How many remote images were held back. */
  blockedImages: number;
}

const EMAIL_CONFIG = {
  WHOLE_DOCUMENT: false,
  FORBID_TAGS: ['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base', 'svg', 'math'],
  FORBID_ATTR: ['srcset', 'ping', 'formaction', 'action', 'background', 'poster'],
  ALLOW_DATA_ATTR: false,
};

const REMOTE = /^\s*(https?:)?\/\//i;

/** Cleans an email body for display. With `allowImages` false, remote images and backgrounds are removed. */
export function cleanEmailHtml(raw: string, allowImages: boolean): CleanEmail {
  let blocked = 0;
  const purify = DOMPurify();
  purify.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element;
    if (el.tagName === 'A') {
      const href = el.getAttribute('href') ?? '';
      if (/^\s*(javascript|data|vbscript):/i.test(href)) el.removeAttribute('href');
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer nofollow');
    }
    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src') ?? '';
      if (REMOTE.test(src)) {
        if (!allowImages) {
          blocked++;
          el.removeAttribute('src');
          el.setAttribute('data-blocked', '');
          el.setAttribute('alt', el.getAttribute('alt') || 'Image hidden');
        }
      } else if (!/^\s*(data:image\/|cid:)/i.test(src)) {
        el.removeAttribute('src');
      }
    }
    const style = el.getAttribute('style');
    if (style && /url\s*\(/i.test(style)) {
      if (!allowImages) blocked++;
      if (!allowImages || /url\s*\(\s*['"]?\s*(javascript|data:(?!image\/))/i.test(style)) {
        el.setAttribute('style', style.replace(/url\s*\([^)]*\)/gi, 'none'));
      }
    }
  });
  const html = purify.sanitize(raw, EMAIL_CONFIG) as string;
  return { html, blockedImages: blocked };
}

/** The document shown inside the sandboxed frame. Its CSP is the last line: no scripts, no remote loads unless allowed. */
export function emailDocument(body: string, { allowImages, dark }: { allowImages: boolean; dark: boolean }): string {
  const img = allowImages ? 'img-src data: cid: https: http:;' : 'img-src data: cid:;';
  // Email that sets its own colours was designed for a light page, so it keeps one in dark mode.
  const paper = dark && hasOwnColours(body);
  const night = dark && !paper;
  const ink = night ? '#eef1fa' : '#141a2e';
  const link = night ? '#8fa9fa' : '#3b5bd6';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${img} style-src 'unsafe-inline'; font-src data:;">
<base target="_blank">
<style>
  :root { color-scheme: ${dark ? 'dark' : 'light'}; }
  html, body { margin: 0; padding: 0; background: ${paper ? '#ffffff' : 'transparent'}; }
  ${paper ? 'body { padding: 16px; border-radius: 12px; }' : ''}
  /* flow-root keeps the first and last paragraph margins inside the body, so the frame fits. */
  body { display: flow-root; font: 15px/1.6 Manrope, 'Helvetica Neue', system-ui, sans-serif; color: ${ink}; overflow-wrap: anywhere; }
  a { color: ${link}; }
  img { max-width: 100%; height: auto; }
  img[data-blocked] { display: inline-block; min-width: 24px; min-height: 24px; background: rgba(127,127,127,.12); border-radius: 6px; }
  table { max-width: 100%; }
  blockquote { margin: 0 0 0 4px; padding-left: 12px; border-left: 3px solid rgba(127,127,127,.35); }
  pre { white-space: pre-wrap; }
</style></head><body>${body}</body></html>`;
}

function hasOwnColours(html: string): boolean {
  return /\bbgcolor\s*=|style\s*=\s*["'][^"']*\b(background(-color)?|color)\s*:/i.test(html);
}

/** Formatting written in Type's composer: only these tags survive. */
export function cleanRichText(raw: string): string {
  const purify = DOMPurify();
  purify.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element;
    if (el.tagName === 'A') {
      const href = el.getAttribute('href') ?? '';
      if (!/^(https?:|mailto:)/i.test(href)) el.removeAttribute('href');
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
  return purify.sanitize(raw, {
    ALLOWED_TAGS: ['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a', 'blockquote'],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
  }) as string;
}

/** Plain text from composer HTML, for the text part and for snippets. */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(cleanRichText(html), 'text/html');
  const out: string[] = [];
  const walk = (node: Node, listIndex?: { n: number; ordered: boolean }) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out.push(child.textContent ?? '');
        return;
      }
      const el = child as Element;
      const tag = el.tagName;
      if (tag === 'BR') {
        out.push('\n');
        return;
      }
      if (tag === 'UL' || tag === 'OL') {
        if (out.length && !out[out.length - 1].endsWith('\n')) out.push('\n');
        walk(el, { n: 0, ordered: tag === 'OL' });
        return;
      }
      if (tag === 'LI') {
        const index = listIndex ? ++listIndex.n : 1;
        out.push(listIndex?.ordered ? `${index}. ` : '- ');
        walk(el);
        out.push('\n');
        return;
      }
      if (tag === 'A') {
        walk(el);
        const href = el.getAttribute('href');
        if (href && href !== el.textContent && !href.startsWith('mailto:')) out.push(` (${href})`);
        return;
      }
      const block = tag === 'P' || tag === 'DIV' || tag === 'BLOCKQUOTE';
      if (block && out.length && !out[out.length - 1].endsWith('\n')) out.push('\n');
      walk(el);
      if (block) out.push('\n');
    });
  };
  walk(doc.body);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

/** Plain text shown safely: escaped, links made clickable, line breaks kept. */
export function linkify(text: string): string {
  const escaped = text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  return escaped.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>`);
}

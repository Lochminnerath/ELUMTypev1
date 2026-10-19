import { useEffect } from 'react';

/**
 * Shows another symbol in the browser tab while a page is open, such as a document's symbol on
 * a document, and puts the app's own icon back when it closes. `href` is an SVG in public/.
 */
export function useFavicon(href: string | null) {
  useEffect(() => {
    if (!href) return;
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'));
    const saved = links.map((l) => ({ link: l, href: l.getAttribute('href'), type: l.getAttribute('type'), sizes: l.getAttribute('sizes') }));
    for (const l of links) {
      l.setAttribute('href', href);
      l.setAttribute('type', 'image/svg+xml');
      l.removeAttribute('sizes');
    }
    return () => {
      for (const { link, href: was, type, sizes } of saved) {
        if (was) link.setAttribute('href', was);
        if (type) link.setAttribute('type', type);
        else link.removeAttribute('type');
        if (sizes) link.setAttribute('sizes', sizes);
      }
    };
  }, [href]);
}

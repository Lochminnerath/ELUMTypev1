import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { useFavicon } from './favicon';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Page({ href }: { href: string | null }) {
  useFavicon(href);
  return null;
}

function open(href: string | null) {
  const root = createRoot(document.createElement('div'));
  act(() => root.render(<Page href={href} />));
  return () => act(() => root.unmount());
}

describe('useFavicon', () => {
  it('shows the page symbol while open and puts the app icon back after', () => {
    document.head.innerHTML = '<link rel="icon" href="/favicon.ico?v=2" sizes="48x48"><link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml">';
    const close = open('/favicons/doc.svg');
    const links = Array.from(document.querySelectorAll('link[rel="icon"]'));
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/favicons/doc.svg', '/favicons/doc.svg']);
    expect(links[0].getAttribute('sizes')).toBeNull();
    close();
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/favicon.ico?v=2', '/favicon.svg?v=2']);
    expect(links[0].getAttribute('sizes')).toBe('48x48');
    expect(links[0].getAttribute('type')).toBeNull();
  });

  it('leaves the app icon alone when there is nothing to show', () => {
    document.head.innerHTML = '<link rel="icon" href="/favicon.svg">';
    open(null);
    expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('/favicon.svg');
  });
});

/**
 * On Netlify's free plan, Netlify puts a "Powered by Netlify" badge in the bottom-right corner of
 * every page, on top of everything. ELUM does not hide it (it is part of that plan). Instead the
 * app makes room: while the badge is on the page, the app ends a strip above the bottom of the
 * window, the height of the badge, so no button, toolbar or player sits under it. The strip goes
 * away by itself when the badge does.
 *
 * Sets `--host-badge-h` (the badge's height, or 0px) and the `has-host-badge` class on <html>.
 */
export const HOST_BADGE_ID = 'nl-badge-frame';

export function badgeHeight(doc: Document = document): number {
  const frame = doc.getElementById(HOST_BADGE_ID);
  if (!frame) return 0;
  const rect = frame.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? Math.ceil(rect.height) : 0;
}

export function applyHostBadge(doc: Document = document): number {
  const root = doc.documentElement;
  const h = badgeHeight(doc);
  if (h > 0) {
    root.style.setProperty('--host-badge-h', `${h}px`);
    root.classList.add('has-host-badge');
  } else {
    root.style.removeProperty('--host-badge-h');
    root.classList.remove('has-host-badge');
  }
  return h;
}

/** Watches for the badge to arrive, change size or leave. Returns a function that stops watching. */
export function watchHostBadge(doc: Document = document): () => void {
  const win = doc.defaultView;
  let frame: Element | null = null;
  const onFrame = new MutationObserver(() => applyHostBadge(doc));
  const check = () => {
    const now = doc.getElementById(HOST_BADGE_ID);
    if (now !== frame) {
      onFrame.disconnect();
      frame = now;
      if (frame) onFrame.observe(frame, { attributes: true, attributeFilter: ['style', 'hidden', 'class'] });
    }
    applyHostBadge(doc);
  };
  const onBody = new MutationObserver(check);
  onBody.observe(doc.body, { childList: true });
  win?.addEventListener('resize', check);
  check();
  return () => {
    onBody.disconnect();
    onFrame.disconnect();
    win?.removeEventListener('resize', check);
  };
}

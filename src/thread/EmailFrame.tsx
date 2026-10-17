import { useEffect, useMemo, useRef, useState } from 'react';
import { cleanEmailHtml, emailDocument } from '../lib/sanitize';
import { useTheme } from '../theme/ThemeProvider';

/**
 * An email's HTML, cleaned and shown in a sandboxed frame. The sandbox has no allow-scripts, so
 * nothing in an email can ever run; the frame's CSP blocks remote loads until images are allowed.
 */
export function EmailFrame({ html, allowImages, title, onBlocked }: { html: string; allowImages: boolean; title: string; onBlocked?: (count: number) => void }) {
  const { theme } = useTheme();
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);
  const clean = useMemo(() => cleanEmailHtml(html, allowImages), [html, allowImages]);
  const doc = useMemo(() => emailDocument(clean.html, { allowImages, dark: theme === 'dark' }), [clean.html, allowImages, theme]);

  useEffect(() => {
    onBlocked?.(clean.blockedImages);
  }, [clean.blockedImages, onBlocked]);

  const observer = useRef<ResizeObserver | null>(null);
  const measure = () => {
    // The body, not the root: the root is at least as tall as the frame, so it would only ever grow.
    const body = ref.current?.contentDocument?.body;
    if (body) setHeight(Math.ceil(body.getBoundingClientRect().height) + 2);
  };
  const onLoad = () => {
    measure();
    observer.current?.disconnect();
    const body = ref.current?.contentDocument?.body;
    if (body) {
      observer.current = new ResizeObserver(measure);
      observer.current.observe(body);
    }
  };
  useEffect(() => () => observer.current?.disconnect(), []);

  return (
    <iframe
      ref={ref}
      className="email-frame"
      title={title}
      srcDoc={doc}
      // Same origin only so the app can measure the height. Never allow-scripts.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      style={{ height }}
      onLoad={onLoad}
    />
  );
}

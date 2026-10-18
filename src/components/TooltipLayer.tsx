import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeFloating } from './Popover';

const DELAY = 450;

/**
 * One tooltip for the whole app. Any element with `data-tip` gets a tooltip on
 * hover or keyboard focus. Rendered in a portal so scroll areas never clip it.
 */
export function TooltipLayer() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [text, setText] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timer.current);
      setTarget(null);
    };
    const show = (el: HTMLElement, immediate = false) => {
      window.clearTimeout(timer.current);
      const open = () => {
        if (!el.isConnected || el.getAttribute('aria-expanded') === 'true') return;
        setText(el.dataset.tip ?? '');
        setTarget(el);
      };
      if (immediate) open();
      else timer.current = window.setTimeout(open, DELAY);
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-tip]');
      if (el) show(el);
      else hide();
    };
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (el.dataset?.tip && el.matches(':focus-visible')) show(el, true);
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      window.removeEventListener('scroll', hide, true);
      window.clearTimeout(timer.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (!target || !tipRef.current) {
      setPos(null);
      return;
    }
    const tip = tipRef.current;
    const rect = target.getBoundingClientRect();
    if (target.getAttribute('data-tip-placement') === 'right') {
      // Beside tools in a vertical column.
      setPos({ top: rect.top + rect.height / 2 - tip.offsetHeight / 2, left: rect.right + 8 });
      return;
    }
    const { top, left } = placeFloating(rect, tip.offsetWidth, tip.offsetHeight, 'bottom-center', 6);
    setPos({ top, left });
  }, [target, text]);

  if (!target) return null;
  return createPortal(
    <div ref={tipRef} role="tooltip" className="tooltip" style={pos ?? { top: 0, left: 0, opacity: 0 }}>
      {text}
    </div>,
    target.closest('dialog[open]') ?? document.body,
  );
}

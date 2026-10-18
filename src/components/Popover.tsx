import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import './Popover.css';

export type Placement = 'bottom-start' | 'bottom-end' | 'bottom-center' | 'top-start' | 'right-start';

const MARGIN = 8;

/** Where a floating panel should sit next to its anchor, kept inside the viewport. */
export function placeFloating(anchor: DOMRect, width: number, height: number, placement: Placement, gap = 4) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top: number;
  let left: number;

  if (placement === 'right-start') {
    left = anchor.right + gap;
    if (left + width > vw - MARGIN) left = anchor.left - gap - width;
    top = anchor.top - 6;
  } else {
    const below = anchor.bottom + gap;
    const above = anchor.top - gap - height;
    const wantsAbove = placement === 'top-start';
    top = wantsAbove ? (above >= MARGIN ? above : below) : below + height <= vh - MARGIN || above < MARGIN ? below : above;
    left =
      placement === 'bottom-end'
        ? anchor.right - width
        : placement === 'bottom-center'
          ? anchor.left + anchor.width / 2 - width / 2
          : anchor.left;
  }

  left = Math.max(MARGIN, Math.min(left, vw - width - MARGIN));
  top = Math.max(MARGIN, Math.min(top, vh - height - MARGIN));
  return { top, left, maxHeight: vh - MARGIN * 2 };
}

/** Floating panels inside a modal <dialog> must render inside it to stay in the top layer. */
export function portalTargetFor(el: Element | null): Element {
  return el?.closest('dialog[open]') ?? document.body;
}

const HIDDEN: CSSProperties = { top: 0, left: 0, opacity: 0 };

/** Positions `floating` next to `anchor` and keeps it there on scroll and resize. */
export function useFloatingPosition(
  open: boolean,
  anchor: RefObject<Element | null> | (() => DOMRect | null),
  floating: RefObject<HTMLElement | null>,
  placement: Placement,
) {
  // Hidden with opacity, not visibility, so it can take focus before its first placement.
  const [style, setStyle] = useState<CSSProperties>(HIDDEN);

  const update = useCallback(() => {
    const rect = typeof anchor === 'function' ? anchor() : (anchor.current?.getBoundingClientRect() ?? null);
    const el = floating.current;
    if (!rect || !el) return;
    const { top, left, maxHeight } = placeFloating(rect, el.offsetWidth, el.offsetHeight, placement);
    setStyle({ top, left, maxHeight });
  }, [anchor, floating, placement]);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(HIDDEN);
      return;
    }
    update();
    // Content (fonts, async lists) can change the size right after opening.
    const ro = new ResizeObserver(update);
    if (floating.current) ro.observe(floating.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, update, floating]);

  return style;
}

/** Closes when someone presses outside every element in `inside`. */
export function useOutsidePress(open: boolean, inside: () => (Element | null)[], onOutside: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (inside().some((el) => el?.contains(target))) return;
      onOutside();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, inside, onOutside]);
}

export interface TriggerProps {
  ref: RefObject<HTMLButtonElement | null>;
  onClick: () => void;
  onKeyDown: (e: ReactKeyboardEvent) => void;
  'aria-haspopup': 'dialog' | 'menu' | 'listbox';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
}

interface PopoverProps {
  trigger: (props: TriggerProps) => ReactNode;
  children: (close: () => void) => ReactNode;
  placement?: Placement;
  label: string;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Return focus to the trigger on close. Turn off when the content hands focus elsewhere, like the editor. */
  restoreFocus?: boolean;
}

/** A small non-modal panel attached to a button: colour pickers, link fields and the like. */
export function Popover({ trigger, children, placement = 'bottom-start', label, className, open: controlled, onOpenChange, restoreFocus = true }: PopoverProps) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlled ?? uncontrolled;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const setOpen = useCallback(
    (next: boolean) => {
      setUncontrolled(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const close = useCallback(
    (focusTrigger = restoreFocus) => {
      setOpen(false);
      if (focusTrigger) triggerRef.current?.focus({ preventScroll: true });
    },
    [setOpen, restoreFocus],
  );

  const style = useFloatingPosition(open, triggerRef, panelRef, placement);
  const inside = useCallback(() => [triggerRef.current, panelRef.current], []);
  const closeQuietly = useCallback(() => close(false), [close]);
  useOutsidePress(open, inside, closeQuietly);

  // Move focus into the panel when it opens.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      const target = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>('input, button, [tabindex]:not([tabindex="-1"])');
      (target ?? panel)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <>
      {trigger({
        ref: triggerRef,
        onClick: () => setOpen(!open),
        onKeyDown: (e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        },
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        'aria-controls': open ? id : undefined,
      })}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            role="dialog"
            aria-label={label}
            tabIndex={-1}
            className={`floating-panel ${className ?? ''}`}
            style={style}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                close(true);
              }
            }}
          >
            {children(() => close())}
          </div>,
          portalTargetFor(triggerRef.current),
        )}
    </>
  );
}

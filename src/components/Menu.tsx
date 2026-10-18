import { Check, ChevronRight } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { portalTargetFor, useFloatingPosition, useOutsidePress, type Placement, type TriggerProps } from './Popover';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  hint?: string;
  /** Shows a check mark. `undefined` means the item is not checkable. */
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  /** Style for the label, such as a font preview. */
  labelStyle?: CSSProperties;
  onSelect?: () => void;
  items?: MenuEntry[];
}

export type MenuEntry = MenuItem | 'separator' | { heading: string };

const isItem = (e: MenuEntry): e is MenuItem => typeof e === 'object' && 'label' in e;
const SUBMENU_DELAY = 120;

interface MenuProps {
  trigger: (props: TriggerProps) => ReactNode;
  items: MenuEntry[] | (() => MenuEntry[]);
  label: string;
  placement?: Placement;
  header?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/** A dropdown menu with keyboard support and nested submenus. */
export function Menu({ trigger, items, label, placement = 'bottom-start', header, open: controlled, onOpenChange, className }: MenuProps) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlled ?? uncontrolled;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootId = useId();
  const [openedByKey, setOpenedByKey] = useState(false);

  const setOpen = useCallback(
    (next: boolean) => {
      setUncontrolled(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const closeAll = useCallback(
    (focusTrigger: boolean) => {
      setOpen(false);
      if (focusTrigger) triggerRef.current?.focus({ preventScroll: true });
    },
    [setOpen],
  );

  const inside = useCallback(
    () => [triggerRef.current, ...Array.from(document.querySelectorAll(`[data-menu-root="${CSS.escape(rootId)}"]`))],
    [rootId],
  );
  const closeQuietly = useCallback(() => closeAll(false), [closeAll]);
  useOutsidePress(open, inside, closeQuietly);

  const entries = useMemo(() => (open ? (typeof items === 'function' ? items() : items) : []), [open, items]);

  return (
    <>
      {trigger({
        ref: triggerRef,
        onClick: () => {
          setOpenedByKey(false);
          setOpen(!open);
        },
        onKeyDown: (e) => {
          if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !open) {
            e.preventDefault();
            setOpenedByKey(true);
            setOpen(true);
          }
        },
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': undefined,
      })}
      {open && (
        <MenuList
          rootId={rootId}
          entries={entries}
          label={label}
          anchor={() => triggerRef.current?.getBoundingClientRect() ?? null}
          portalTarget={portalTargetFor(triggerRef.current)}
          placement={placement}
          header={header}
          className={className}
          highlightFirst={openedByKey}
          onCloseAll={closeAll}
          onCloseSelf={() => closeAll(true)}
        />
      )}
    </>
  );
}

interface MenuListProps {
  rootId: string;
  entries: MenuEntry[];
  label: string;
  anchor: () => DOMRect | null;
  portalTarget: Element;
  placement: Placement;
  header?: ReactNode;
  className?: string;
  highlightFirst: boolean;
  onCloseAll: (focusTrigger: boolean) => void;
  /** Close just this list (Escape / ArrowLeft in a submenu). */
  onCloseSelf: () => void;
  /** For submenus: hand ArrowLeft back to the parent. */
  isSubmenu?: boolean;
}

function MenuList({
  rootId,
  entries,
  label,
  anchor,
  portalTarget,
  placement,
  header,
  className,
  highlightFirst,
  onCloseAll,
  onCloseSelf,
  isSubmenu,
}: MenuListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const idBase = useId();
  const enabled = entries.map((e, i) => (isItem(e) && !e.disabled ? i : -1)).filter((i) => i >= 0);
  const [active, setActive] = useState(() => (highlightFirst ? (enabled[0] ?? -1) : -1));
  const [submenu, setSubmenu] = useState<{ index: number; byKey: boolean } | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);

  const style = useFloatingPosition(true, anchor, listRef, placement);

  useEffect(() => {
    listRef.current?.focus({ preventScroll: true });
    return () => window.clearTimeout(hoverTimer.current);
  }, []);

  useEffect(() => {
    if (active >= 0) itemRefs.current[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const move = (delta: number) => {
    if (!enabled.length) return;
    const pos = enabled.indexOf(active);
    const next = pos < 0 ? (delta > 0 ? 0 : enabled.length - 1) : (pos + delta + enabled.length) % enabled.length;
    setActive(enabled[next]);
  };

  const activate = (index: number, byKey: boolean) => {
    const entry = entries[index];
    if (!isItem(entry) || entry.disabled) return;
    if (entry.items) {
      setSubmenu({ index, byKey });
      return;
    }
    onCloseAll(false);
    entry.onSelect?.();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (submenu) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Home':
        e.preventDefault();
        setActive(enabled[0] ?? -1);
        break;
      case 'End':
        e.preventDefault();
        setActive(enabled[enabled.length - 1] ?? -1);
        break;
      case 'ArrowRight':
        if (active >= 0 && isItem(entries[active]) && (entries[active] as MenuItem).items) {
          e.preventDefault();
          activate(active, true);
        }
        break;
      case 'ArrowLeft':
        if (isSubmenu) {
          e.preventDefault();
          e.stopPropagation();
          onCloseSelf();
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (active >= 0) activate(active, true);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onCloseSelf();
        break;
      case 'Tab':
        onCloseAll(false);
        break;
      default:
        // Type-ahead: jump to the next item starting with the typed letter.
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const letter = e.key.toLowerCase();
          const start = enabled.indexOf(active);
          const order = [...enabled.slice(start + 1), ...enabled.slice(0, start + 1)];
          const hit = order.find((i) => (entries[i] as MenuItem).label.toLowerCase().startsWith(letter));
          if (hit !== undefined) setActive(hit);
        }
    }
  };

  const activeId = active >= 0 ? `${idBase}-${active}` : undefined;
  const submenuEntry = submenu ? (entries[submenu.index] as MenuItem) : null;

  return createPortal(
    <>
      <div
        ref={listRef}
        role="menu"
        aria-label={label}
        aria-activedescendant={activeId}
        tabIndex={-1}
        data-menu-root={rootId}
        className={`floating-panel menu ${className ?? ''}`}
        style={style}
        onKeyDown={onKeyDown}
      >
        {header}
        {entries.map((entry, index) => {
          if (entry === 'separator') return <div key={index} role="separator" className="menu__sep" />;
          if (!isItem(entry)) {
            return (
              <div key={index} role="presentation" className="menu__heading">
                {entry.heading}
              </div>
            );
          }
          const checkable = entry.checked !== undefined;
          return (
            <div
              key={index}
              id={`${idBase}-${index}`}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              role={checkable ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={checkable ? entry.checked : undefined}
              aria-disabled={entry.disabled || undefined}
              aria-haspopup={entry.items ? 'menu' : undefined}
              aria-expanded={entry.items ? submenu?.index === index : undefined}
              className="menu__item"
              data-active={active === index || submenu?.index === index}
              data-danger={entry.danger || undefined}
              onPointerEnter={() => {
                if (entry.disabled) return;
                setActive(index);
                window.clearTimeout(hoverTimer.current);
                hoverTimer.current = window.setTimeout(() => {
                  setSubmenu(entry.items ? { index, byKey: false } : null);
                }, SUBMENU_DELAY);
              }}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => activate(index, false)}
            >
              <span className="menu__check">{checkable && entry.checked && <Check size={16} strokeWidth={2} />}</span>
              {entry.icon && <span className="menu__icon">{entry.icon}</span>}
              <span className="menu__label" style={entry.labelStyle}>
                {entry.label}
                {entry.hint && <span className="menu__hint">{entry.hint}</span>}
              </span>
              {entry.shortcut && <span className="menu__shortcut kbd">{entry.shortcut}</span>}
              {entry.items && <ChevronRight className="menu__chevron" size={16} strokeWidth={1.75} />}
            </div>
          );
        })}
      </div>
      {submenu && submenuEntry?.items && (
        <MenuList
          rootId={rootId}
          entries={submenuEntry.items}
          label={submenuEntry.label}
          anchor={() => itemRefs.current[submenu.index]?.getBoundingClientRect() ?? null}
          portalTarget={portalTarget}
          placement="right-start"
          highlightFirst={submenu.byKey}
          isSubmenu
          onCloseAll={onCloseAll}
          onCloseSelf={() => {
            setSubmenu(null);
            listRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </>,
    portalTarget,
  );
}

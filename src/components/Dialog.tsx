import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import './Dialog.css';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** Icon or mark shown before the title. */
  icon?: ReactNode;
}

/** A modal built on the native <dialog>: focus stays inside and Escape closes it. */
export function Dialog({ open, onClose, title, description, children, footer, width = 480, icon }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Start in the first field rather than on the close button.
      dialog
        .querySelector<HTMLElement>('[data-autofocus], .dialog__body input:not([type=hidden]), .dialog__body textarea, .dialog__body select')
        ?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      style={{ width: `min(${width}px, calc(100vw - 32px))` }}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        // A press on the backdrop lands on the <dialog> element itself.
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="dialog__inner">
          <header className="dialog__header">
            {icon && <span className="dialog__icon">{icon}</span>}
            <div className="dialog__titles">
              <h2 id={titleId} className="dialog__title">
                {title}
              </h2>
              {description && (
                <p id={descId} className="dialog__desc">
                  {description}
                </p>
              )}
            </div>
            <button type="button" className="icon-btn icon-btn--round dialog__close" aria-label="Close" onClick={onClose}>
              <X size={18} strokeWidth={1.75} />
            </button>
          </header>
          {children && <div className="dialog__body">{children}</div>}
          {footer && <footer className="dialog__footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

import { CircleCheck, TriangleAlert, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import './Toast.css';

type Tone = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
  action?: { label: string; onClick: () => void };
}

type ShowToast = (message: string, options?: { tone?: Tone; action?: ToastItem['action']; duration?: number }) => void;

const ToastContext = createContext<ShowToast | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback<ShowToast>(
    (message, { tone = 'info', action, duration = 4500 } = {}) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-2), { id, message, tone, action }]);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const value = useMemo(() => show, [show]);

  // Toasts live in the top layer so they show above open dialogs too.
  const stackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stackRef.current;
    if (!el || typeof el.showPopover !== 'function') return;
    try {
      if (el.matches(':popover-open')) el.hidePopover();
      if (toasts.length) el.showPopover();
    } catch {
      // Older browsers: the stack still shows, just under modal dialogs.
    }
  }, [toasts]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div ref={stackRef} className="toasts" role="status" aria-live="polite" popover="manual">
        {toasts.map((t) => (
          <div key={t.id} className="toast" data-tone={t.tone}>
            {t.tone === 'error' ? (
              <TriangleAlert size={18} strokeWidth={1.75} />
            ) : t.tone === 'success' ? (
              <CircleCheck size={18} strokeWidth={1.75} />
            ) : null}
            <span className="toast__msg">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Toast, { ToastData } from './Toast';

interface ToastContextValue {
  push: (toast: Omit<ToastData, 'id'> & { id?: string }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its provider is intentional; splitting would churn imports app-wide for a fast-refresh nicety
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

export interface ToastProviderProps {
  children: ReactNode;
  /** Max number of toasts stacked at once. Older ones auto-dismiss when limit is hit. */
  limit?: number;
}

export default function ToastProvider({ children, limit = 4 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const clear = useCallback(() => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current.clear();
    setToasts([]);
  }, []);

  const push = useCallback<ToastContextValue['push']>(
    (toast) => {
      const id = toast.id ?? `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const ttl = toast.ttl ?? 3500;
      setToasts((prev) => {
        const next = [...prev, { ...toast, id } as ToastData];
        if (next.length <= limit) return next;
        const dropped = next.slice(0, next.length - limit);
        dropped.forEach((d) => {
          const t = timers.current.get(d.id);
          if (t) clearTimeout(t);
          timers.current.delete(d.id);
        });
        return next.slice(-limit);
      });
      if (ttl > 0) {
        const t = setTimeout(() => dismiss(id), ttl);
        timers.current.set(id, t);
      }
      return id;
    },
    [dismiss, limit],
  );

  useEffect(() => {
    return () => {
      timers.current.forEach((t) => clearTimeout(t));
      timers.current.clear();
    };
  }, []);

  const value = useMemo(() => ({ push, dismiss, clear }), [push, dismiss, clear]);

  const host = typeof document !== 'undefined' ? document.body : null;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {host
        ? createPortal(
            <div
              className="fixed bottom-4 right-4 z-[300] flex flex-col gap-2 pointer-events-none"
              aria-live="polite"
              aria-atomic="false"
            >
              {toasts.map((t) => (
                <div key={t.id} className="pointer-events-auto">
                  <Toast toast={t} onDismiss={dismiss} />
                </div>
              ))}
            </div>,
            host,
          )
        : null}
    </ToastContext.Provider>
  );
}

import { useEffect } from 'react';
import { AlertCircle, Check, X } from 'lucide-react';

interface ToastProps {
  message: string;
  type?: 'success' | 'error';
  onClose: () => void;
  duration?: number;
}

export default function Toast({ message, type = 'success', onClose, duration = 4000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [onClose, duration]);

  const isError = type === 'error';
  const dotColor = isError ? 'var(--color-urgent)' : 'var(--color-ok)';
  const Icon = isError ? AlertCircle : Check;

  return (
    <div
      role="status"
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
      className="fixed top-6 right-6 z-[300] animate-[v2p-slide-in_260ms_ease-out]"
    >
      <div className="min-w-[240px] max-w-[360px] flex items-start gap-2.5 px-3.5 py-2.5 bg-[var(--color-bg-surface)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)]">
        <span
          aria-hidden="true"
          className="mt-[6px] inline-flex items-center justify-center shrink-0 rounded-full"
          style={{ width: 18, height: 18, background: isError ? 'var(--color-urgent-soft)' : 'var(--color-accent-soft)' }}
        >
          <Icon size={12} className="shrink-0" style={{ color: dotColor }} />
        </span>
        <p className="flex-1 text-[13px] font-medium text-[var(--color-ink)] leading-snug">{message}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

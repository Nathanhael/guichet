import { ReactNode } from 'react';
import { X } from 'lucide-react';

export type ToastTone = 'info' | 'ok' | 'urgent' | 'accent';

export interface ToastData {
  id: string;
  tone?: ToastTone;
  title: ReactNode;
  body?: ReactNode;
  /** Optional inline action button. */
  action?: { label: string; onClick: () => void };
  /** Milliseconds before auto-dismiss. Default 3500. Pass 0 to keep open. */
  ttl?: number;
}

export interface ToastProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

const DOT: Record<ToastTone, string> = {
  info: 'var(--color-accent)',
  ok: 'var(--color-ok)',
  urgent: 'var(--color-urgent)',
  accent: 'var(--color-accent)',
};

export default function Toast({ toast, onDismiss }: ToastProps) {
  const tone = toast.tone ?? 'info';
  return (
    <div
      role="status"
      className="min-w-[240px] max-w-[360px] bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-[10px] shadow-[var(--shadow-card)] px-3.5 py-2.5 animate-[v2p-slide-in_260ms_ease-out] flex items-start gap-2.5"
    >
      <span
        aria-hidden="true"
        className="mt-[6px] inline-block shrink-0 rounded-full"
        style={{ width: 8, height: 8, background: DOT[tone] }}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-[var(--color-ink)] leading-tight">{toast.title}</div>
        {toast.body ? (
          <div className="mt-0.5 text-[12px] text-[var(--color-ink-soft)] leading-snug">{toast.body}</div>
        ) : null}
        {toast.action ? (
          <button
            type="button"
            onClick={toast.action.onClick}
            className="mt-1.5 text-[12px] font-semibold text-[var(--color-accent)] hover:underline"
          >
            {toast.action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

import { HTMLAttributes, ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Base id used for aria-labelledby / aria-describedby wiring. */
  id?: string;
  /** Max width in px. Default matches the spec: 440. */
  maxWidth?: number;
  /** Render into a specific container instead of document.body. */
  container?: HTMLElement | null;
  /** Disable closing on backdrop click (confirm / destructive flows). */
  dismissOnBackdrop?: boolean;
  /** Disable closing on Escape. */
  dismissOnEscape?: boolean;
  children?: ReactNode;
}

export interface ModalHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Caller may attach a close handler; the default X is rendered when provided. */
  onClose?: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Custom right-slot (overrides the default close button). */
  actions?: ReactNode;
}

export interface ModalBodyProps extends HTMLAttributes<HTMLDivElement> {}
export interface ModalFooterProps extends HTMLAttributes<HTMLDivElement> {}

export function ModalHeader({ onClose, title, subtitle, actions, className = '', children, ...rest }: ModalHeaderProps) {
  return (
    <div
      className={`px-5 pt-5 pb-4 flex items-start justify-between gap-4 ${className}`.trim()}
      {...rest}
    >
      <div className="min-w-0">
        {title !== undefined ? (
          <h2 className="text-[17px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">{title}</h2>
        ) : null}
        {subtitle !== undefined ? (
          <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">{subtitle}</p>
        ) : null}
        {children}
      </div>
      {actions !== undefined ? (
        <div className="shrink-0 flex items-center gap-1">{actions}</div>
      ) : onClose ? (
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-btn)] text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

export function ModalBody({ className = '', children, ...rest }: ModalBodyProps) {
  return (
    <div className={`px-5 py-2 text-[13px] text-[var(--color-ink-soft)] ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

export function ModalFooter({ className = '', children, ...rest }: ModalFooterProps) {
  return (
    <div
      className={`px-5 py-4 mt-2 flex justify-end gap-2 bg-[var(--color-bg-elevated)] border-t border-[var(--color-border)] rounded-b-[var(--radius-card)] ${className}`.trim()}
      {...rest}
    >
      {children}
    </div>
  );
}

export default function Modal({
  open,
  onClose,
  id,
  maxWidth = 440,
  container,
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  children,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !dismissOnEscape) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, dismissOnEscape, onClose]);

  useEffect(() => {
    if (!open) return;
    cardRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const host = container ?? (typeof document !== 'undefined' ? document.body : null);
  if (!host) return null;

  const scrim = (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[var(--color-scrim)] animate-[fade-in_150ms_ease-out]"
      onClick={dismissOnBackdrop ? onClose : undefined}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id ? `${id}-title` : undefined}
        aria-describedby={id ? `${id}-desc` : undefined}
        tabIndex={-1}
        style={{ maxWidth }}
        className="relative w-full outline-none bg-[var(--color-bg-surface)] rounded-[var(--radius-card)] shadow-[var(--shadow-modal)] animate-[v2p-pop_180ms_ease-out] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );

  return createPortal(scrim, host);
}

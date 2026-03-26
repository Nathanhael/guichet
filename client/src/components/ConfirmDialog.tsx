import { useT } from '../i18n';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ title, message, confirmLabel, cancelLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const t = useT();

  return (
    <div className="fixed inset-0 z-[200]">
      <div className="absolute inset-0 bg-black/80" onClick={onCancel} aria-label="Close" />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div role="dialog" className="w-full max-w-md bg-[var(--color-bg-surface)] border border-[var(--color-border)] p-8 animate-fade-in relative">
          {/* Icon */}
          <div className="w-14 h-14 border border-[var(--color-border)] flex items-center justify-center mx-auto mb-6">
            <span className="text-[var(--color-accent-red)] text-xl">!</span>
          </div>
          {/* Title */}
          <h2 className="font-mono font-bold text-sm uppercase tracking-wide text-center text-[var(--color-text-primary)] mb-3">
            {title}
          </h2>
          {/* Message */}
          <p className="text-sm text-[var(--color-text-secondary)] text-center mb-8">
            {message}
          </p>
          {/* Actions */}
          <div className="flex gap-3">
            <button className="btn-secondary flex-1" onClick={onCancel}>
              {cancelLabel || t('cancel')}
            </button>
            <button className="btn-danger flex-1" onClick={onConfirm}>
              {confirmLabel || t('yes_close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

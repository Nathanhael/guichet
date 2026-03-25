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
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
      <div onClick={onCancel} aria-label="Close" className="absolute inset-0 bg-black opacity-80" />
      <div role="dialog" className="w-full max-w-md bg-white dark:bg-black border-4 border-black dark:border-white relative z-10 p-8 text-center">
        <div className="w-16 h-16 border-4 border-black dark:border-white flex items-center justify-center mx-auto mb-6 text-2xl font-black">!</div>
        <h3 className="text-xl font-black uppercase tracking-tighter mb-2">{title}</h3>
        <p className="text-sm font-bold uppercase opacity-60 mb-8">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest hover:bg-black/5 dark:hover:bg-white/5"
          >
            {cancelLabel || t('cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-3 bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest hover:invert"
          >
            {confirmLabel || t('yes_close')}
          </button>
        </div>
      </div>
    </div>
  );
}

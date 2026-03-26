import { useEffect } from 'react';

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

  return (
    <div className="fixed top-6 right-6 z-[300] animate-fade-in">
      <div
        className={`flex items-center gap-3 px-6 py-4 border border-[var(--color-border)] ${
          isError
            ? 'bg-[var(--color-accent-red)] text-white'
            : 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)]'
        }`}
      >
        <span className="font-mono text-sm">{isError ? '!' : '\u2713'}</span>
        <p className="font-mono text-[10px] uppercase tracking-wide max-w-xs">{message}</p>
        <button
          onClick={onClose}
          className="ml-2 font-mono text-sm opacity-40 hover:opacity-100"
        >
          &#x2715;
        </button>
      </div>
    </div>
  );
}

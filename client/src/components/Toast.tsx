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
    <div className="fixed top-6 right-6 z-[300] animate-in slide-in-from-top-2">
      <div
        className={`flex items-center gap-3 px-6 py-4 border-2 border-black dark:border-white shadow-[4px_4px_0_0] ${
          isError
            ? 'bg-black text-white dark:bg-white dark:text-black shadow-black dark:shadow-white'
            : 'bg-white text-black dark:bg-black dark:text-white shadow-black dark:shadow-white'
        }`}
      >
        <span className="text-lg font-black">{isError ? '!' : '\u2713'}</span>
        <p className="text-[10px] font-black uppercase tracking-widest max-w-xs">{message}</p>
        <button
          onClick={onClose}
          className="ml-2 text-sm font-black opacity-40 hover:opacity-100"
        >
          \u2715
        </button>
      </div>
    </div>
  );
}

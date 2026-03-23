import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import useStore from '../store/useStore';
import { getSocket } from '../hooks/useSocket';

interface StatusOption {
  key: string;
  label: string;
  dot: string;
}

const STATUSES: StatusOption[] = [
  { key: 'available', label: 'status_available', dot: 'bg-black dark:bg-white' },
  { key: 'break', label: 'status_break', dot: 'bg-slate-400' },
  { key: 'lunch', label: 'status_lunch', dot: 'bg-slate-400' },
  { key: 'meeting', label: 'status_meeting', dot: 'bg-slate-400' },
  { key: 'training', label: 'status_training', dot: 'bg-slate-400' },
];

/**
 * Support staff status picker (available / break / lunch / meeting / training).
 * Emits `support:status` to the server so admins and other staff can see availability.
 */
export default function StatusPicker() {
  const user = useStore((s) => s.user);
  const [value, setValue] = useState('available');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();

  // Close dropdown on outside click
  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, []);

  function handleChange(newStatus: string) {
    setValue(newStatus);
    setOpen(false);

    // Emit status to server so it's visible to admins / other support
    if (user) {
      getSocket().emit('support:status', {
        userId: user.id,
        status: newStatus,
      });
    }
  }

  const current = STATUSES.find((s) => s.key === value) || STATUSES[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`Status: ${t(current.label)}`}
        aria-expanded={open}
        className="flex items-center gap-2 bg-white dark:bg-black border border-black dark:border-white px-2.5 py-1.5 transition-colors group hover:bg-black dark:hover:bg-white"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${current.dot} group-hover:invert`} />
        <span className="text-[10px] font-black uppercase text-black dark:text-white group-hover:text-white dark:group-hover:text-black">
          {t(current.label)}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-black border-2 border-black dark:border-white z-50">
          {STATUSES.map((s) => (
            <button
              key={s.key}
              onClick={() => handleChange(s.key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-[10px] font-black uppercase ${
                s.key === value
                  ? 'bg-black dark:bg-white text-white dark:text-black'
                  : 'text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
              {t(s.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

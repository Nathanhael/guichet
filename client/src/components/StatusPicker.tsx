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
  { key: 'online', label: 'status_online', dot: 'bg-accent-green' },
  { key: 'away', label: 'status_away', dot: 'bg-accent-amber' },
];

/**
 * Support staff status picker (online / away).
 * Emits `support:status` to the server so admins and other staff can see availability.
 */
export default function StatusPicker() {
  const user = useStore((s) => s.user);
  const setAgentStatus = useStore((s) => s.setAgentStatus);
  const [value, setValue] = useState('online');
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

  // Global shortcut: Ctrl+. dispatches `support:open-status-picker` on
  // SupportView. Listening here keeps the picker self-contained.
  useEffect(() => {
    function openPicker() {
      setOpen(true);
    }
    window.addEventListener('support:open-status-picker', openPicker);
    return () => window.removeEventListener('support:open-status-picker', openPicker);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    function onStatusRestored({ status }: { status: string }) {
      const valid = STATUSES.find((s) => s.key === status);
      if (valid) setValue(status);
      if (valid) setAgentStatus(status);
    }
    socket.on('status:restored', onStatusRestored);
    return () => { socket.off('status:restored', onStatusRestored); };
  }, []);

  function handleChange(newStatus: string) {
    setValue(newStatus);
    setAgentStatus(newStatus);
    setOpen(false);

    // Emit status to server so it's visible to admins / other support
    if (user) {
      getSocket().emit('status:set', { status: newStatus });
    }
  }

  const current = STATUSES.find((s) => s.key === value) || STATUSES[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`Status: ${t(current.label)}`}
        aria-expanded={open}
        className="flex items-center gap-2 bg-bg-surface border border-border px-2.5 py-1.5 group hover:bg-bg-elevated"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${current.dot}`} />
        <span className="text-[10px] font-bold uppercase text-text-primary">
          {t(current.label)}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-bg-surface border border-border-heavy z-50">
          {STATUSES.map((s) => (
            <button
              key={s.key}
              onClick={() => handleChange(s.key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-[10px] font-bold uppercase ${
                s.key === value
                  ? 'bg-accent-blue text-[var(--color-btn-text-inverse)]'
                  : 'text-text-primary hover:bg-bg-elevated'
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

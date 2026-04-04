import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import useStore from '../../store/useStore';
import type { ViewMode } from '../../store/slices/uiSlice';

const VIEW_MODES: { key: ViewMode; label: string; icon: string }[] = [
  { key: 'normal', label: 'view_normal', icon: '▣' },
  { key: 'split', label: 'view_split', icon: '▥' },
  { key: 'preview', label: 'view_preview', icon: '▤' },
  { key: 'focus', label: 'view_focus', icon: '□' },
];

export default function ViewModeDropdown() {
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, []);

  const current = VIEW_MODES.find((m) => m.key === viewMode) || VIEW_MODES[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t('view_mode') || 'View Mode'}
        aria-expanded={open}
        title={t('view_mode') || 'View Mode'}
        className="flex items-center gap-1.5 bg-bg-surface border border-border px-2 py-1.5 hover:bg-bg-elevated text-text-primary"
      >
        <span className="text-sm leading-none">{current.icon}</span>
        <span className="text-[9px] font-mono font-bold uppercase tracking-wide hidden sm:inline">
          {t(current.label)}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-bg-surface border-2 border-border-heavy z-50">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode.key}
              onClick={() => {
                setViewMode(mode.key);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-[10px] font-bold uppercase ${
                mode.key === viewMode
                  ? 'bg-accent-blue text-white'
                  : 'text-text-primary hover:bg-bg-elevated'
              }`}
            >
              <span className="text-sm leading-none w-4 text-center">{mode.icon}</span>
              {t(mode.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

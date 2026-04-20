import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n';
import useStore from '../../store/useStore';
import type { ViewMode } from '../../store/slices/uiSlice';

const VIEW_MODES: { key: ViewMode; label: string; icon: string }[] = [
  { key: 'normal', label: 'view_normal', icon: '▣' },
  { key: 'split-grid', label: 'view_split_grid', icon: '⊞' },
  { key: 'split-stack', label: 'view_split_stack', icon: '▥' },
  { key: 'focus', label: 'view_focus', icon: '□' },
];

export default function ViewModeDropdown() {
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        ref.current && !ref.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, []);

  const current = VIEW_MODES.find((m) => m.key === viewMode) || VIEW_MODES[0];
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, []);

  useEffect(() => {
    if (open) updatePos();
  }, [open, updatePos]);

  return (
    <div ref={ref} className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        aria-label={t('view_mode') || 'View Mode'}
        aria-expanded={open}
        title={t('view_mode') || 'View Mode'}
        className="flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] px-2 py-1.5 hover:bg-[var(--color-hover)] text-[var(--color-ink)] transition-colors"
      >
        <span className="text-sm leading-none">{current.icon}</span>
        <span className="text-[11px] font-medium hidden sm:inline">
          {t(current.label)}
        </span>
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="fixed w-44 rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)] z-[9999] overflow-hidden p-1"
          style={{ top: pos.top, right: pos.right }}
        >
          {VIEW_MODES.map((mode) => (
            <button
              key={mode.key}
              onClick={() => {
                setViewMode(mode.key);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12px] font-medium rounded-[var(--radius-btn)] transition-colors ${
                mode.key === viewMode
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                  : 'text-[var(--color-ink)] hover:bg-[var(--color-hover)]'
              }`}
            >
              <span className="text-sm leading-none w-4 text-center">{mode.icon}</span>
              {t(mode.label)}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

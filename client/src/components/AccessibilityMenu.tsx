import { useState, useRef, useEffect, useCallback } from 'react';
import { useStoreShallow } from '../store/useStore';

function ToggleSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      className={`relative w-8 h-4 border ${
        enabled
          ? 'border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/20'
          : 'border-[var(--color-border)] bg-transparent'
      }`}
    >
      <span
        className={`absolute top-[1px] w-3 h-3 ${
          enabled
            ? 'right-[2px] bg-[var(--color-accent-blue)]'
            : 'left-[2px] bg-[var(--color-text-muted)]'
        }`}
      />
    </button>
  );
}

export default function AccessibilityMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const {
    dyslexicMode, toggleDyslexicMode,
    bionicReading, toggleBionicReading,
    monochromeMode, toggleMonochromeMode,
    focusMode, toggleFocusMode,
  } = useStoreShallow(s => ({
    dyslexicMode: s.dyslexicMode,
    toggleDyslexicMode: s.toggleDyslexicMode,
    bionicReading: s.bionicReading,
    toggleBionicReading: s.toggleBionicReading,
    monochromeMode: s.monochromeMode,
    toggleMonochromeMode: s.toggleMonochromeMode,
    focusMode: s.focusMode,
    toggleFocusMode: s.toggleFocusMode,
  }));

  const anyActive = dyslexicMode || bionicReading || focusMode;

  // Ctrl+Shift+F toggles focus mode globally
  const handleKeyboard = useCallback((e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      toggleFocusMode();
    }
  }, [toggleFocusMode]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyboard);
    return () => document.removeEventListener('keydown', handleKeyboard);
  }, [handleKeyboard]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`px-2 py-1 text-[10px] font-bold flex items-center justify-center border ${
          anyActive
            ? 'border-[var(--color-accent-blue)] text-[var(--color-accent-blue)]'
            : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
        }`}
        title="Accessibility Options"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="4" r="2" />
          <path d="M12 8v8" />
          <path d="M6 10l6 2 6-2" />
          <path d="M9 22l3-6 3 6" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 border border-[var(--color-border)] bg-[var(--color-bg-surface)] z-50 p-3">
          <p className="text-[9px] font-bold uppercase tracking-widest opacity-60 mb-3 pb-2 border-b border-[var(--color-border)]">
            Accessibility
          </p>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px]">Dyslexic Font</span>
              <ToggleSwitch enabled={dyslexicMode} onToggle={toggleDyslexicMode} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px]">Bionic Reading</span>
              <ToggleSwitch enabled={bionicReading} onToggle={toggleBionicReading} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px]">Monochrome</span>
              <ToggleSwitch enabled={monochromeMode} onToggle={toggleMonochromeMode} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px]">Focus Mode</span>
                <span className="text-[8px] opacity-40 ml-1.5">Ctrl+Shift+F</span>
              </div>
              <ToggleSwitch enabled={focusMode} onToggle={toggleFocusMode} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

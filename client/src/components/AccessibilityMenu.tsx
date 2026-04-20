import { useState, useRef, useEffect, useCallback } from 'react';
import { Accessibility } from 'lucide-react';
import { useStoreShallow } from '../store/useStore';
import SectionLabel from './ui/SectionLabel';

function ToggleSwitch({ enabled, onToggle, label }: { enabled: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={onToggle}
      className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
        enabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-strong)]'
      }`}
    >
      <span
        className={`inline-block h-3 w-3 rounded-full bg-white shadow-[var(--shadow-soft)] transition-transform ${
          enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'
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

  const anyActive = dyslexicMode || bionicReading || focusMode || monochromeMode;

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
        className={`inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-btn)] border transition-colors ${
          anyActive
            ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-soft)]'
            : 'border-[var(--color-border)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-hover)]'
        }`}
        title="Accessibility options"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Accessibility className="h-3.5 w-3.5" strokeWidth={2} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-60 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)] z-50 p-3">
          <div className="pb-2 mb-3 border-b border-[var(--color-border)]">
            <SectionLabel>Accessibility</SectionLabel>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-[var(--color-ink)]">Dyslexic font</span>
              <ToggleSwitch enabled={dyslexicMode} onToggle={toggleDyslexicMode} label="Dyslexic font" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-[var(--color-ink)]">Bionic reading</span>
              <ToggleSwitch enabled={bionicReading} onToggle={toggleBionicReading} label="Bionic reading" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-[var(--color-ink)]">Monochrome</span>
              <ToggleSwitch enabled={monochromeMode} onToggle={toggleMonochromeMode} label="Monochrome" />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[12px] text-[var(--color-ink)]">Focus mode</span>
                <span className="text-[10px] text-[var(--color-ink-muted)]">Ctrl+Shift+F</span>
              </div>
              <ToggleSwitch enabled={focusMode} onToggle={toggleFocusMode} label="Focus mode" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

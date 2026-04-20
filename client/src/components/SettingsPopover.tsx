import { useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { useT } from '../i18n';
import { useStoreShallow } from '../store/useStore';
import LanguageSwitcher from './LanguageSwitcher';
import DarkModeToggle from './DarkModeToggle';
import ViewModeDropdown from './support/ViewModeDropdown';

export interface SettingsPopoverProps {
  showAccessibility?: boolean;
  showViewMode?: boolean;
}

const ROW = 'flex items-center justify-between gap-4 px-3.5 py-2.5 border-b border-[var(--color-border)] last:border-b-0';
const LABEL = 'text-[12px] font-medium text-[var(--color-ink)] shrink-0';
const SECTION = 'text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] px-3.5 pt-3 pb-1';

function ToggleSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      className={`relative w-9 h-5 rounded-[var(--radius-pill)] shrink-0 transition-colors ${
        enabled
          ? 'bg-[var(--color-accent)]'
          : 'bg-[var(--color-bg-elevated)]'
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-[var(--shadow-soft)] transition-[left] ${
          enabled ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

export default function SettingsPopover({
  showAccessibility = false,
  showViewMode = false,
}: SettingsPopoverProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    darkMode,
    dyslexicMode, toggleDyslexicMode,
    bionicReading, toggleBionicReading,
    monochromeMode, toggleMonochromeMode,
  } = useStoreShallow(s => ({
    darkMode: s.darkMode,
    dyslexicMode: s.dyslexicMode,
    toggleDyslexicMode: s.toggleDyslexicMode,
    bionicReading: s.bionicReading,
    toggleBionicReading: s.toggleBionicReading,
    monochromeMode: s.monochromeMode,
    toggleMonochromeMode: s.toggleMonochromeMode,
  }));

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      {/* Gear button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t('settings')}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors"
      >
        <Settings className="h-4 w-4" />
      </button>

      {/* Popover */}
      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 z-50 min-w-[240px] bg-[var(--color-bg-surface)] rounded-[var(--radius-card)] shadow-[var(--shadow-modal)] overflow-hidden"
          role="dialog"
          aria-label={t('settings')}
        >
          <div className={ROW}>
            <span className={LABEL}>{t('language')}</span>
            <LanguageSwitcher />
          </div>

          {showViewMode && (
            <div className={ROW}>
              <span className={LABEL}>{t('view_mode')}</span>
              <ViewModeDropdown />
            </div>
          )}

          <div className={ROW}>
            <span className={LABEL}>{darkMode ? (t('light_mode') || 'Light Mode') : (t('dark_mode') || 'Dark Mode')}</span>
            <DarkModeToggle />
          </div>

          {showAccessibility && (
            <>
              <div className={SECTION}>{t('accessibility')}</div>
              <div className={ROW}>
                <span className={LABEL}>{t('dyslexic_font')}</span>
                <ToggleSwitch enabled={dyslexicMode} onToggle={toggleDyslexicMode} />
              </div>
              <div className={ROW}>
                <span className={LABEL}>{t('bionic_reading')}</span>
                <ToggleSwitch enabled={bionicReading} onToggle={toggleBionicReading} />
              </div>
              <div className={ROW}>
                <span className={LABEL}>{t('monochrome')}</span>
                <ToggleSwitch enabled={monochromeMode} onToggle={toggleMonochromeMode} />
              </div>
            </>
          )}

        </div>
      )}
    </div>
  );
}

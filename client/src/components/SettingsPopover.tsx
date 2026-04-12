import { useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { useT } from '../i18n';
import { useStoreShallow } from '../store/useStore';
import LanguageSwitcher from './LanguageSwitcher';
import DarkModeToggle from './DarkModeToggle';
import NotificationToggle from './NotificationToggle';
import ViewModeDropdown from './support/ViewModeDropdown';

export interface SettingsPopoverProps {
  showAccessibility?: boolean;
  showNotifications?: boolean;
  showViewMode?: boolean;
}

const ROW = 'flex items-center justify-between gap-4 px-3 py-2 border-b border-[var(--color-border)] last:border-b-0';
const LABEL = 'text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-primary)] shrink-0';
const SECTION = 'text-[8px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-muted)] px-3 pt-2 pb-1';

function ToggleSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      className={`relative w-7 h-4 border shrink-0 ${
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

export default function SettingsPopover({
  showAccessibility = false,
  showNotifications = false,
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

  // Close on outside mousedown
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

  // Close on Escape
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
        className="w-8 h-8 flex items-center justify-center border border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-[var(--color-accent-blue)] hover:text-[var(--color-btn-text-inverse)]"
      >
        <Settings className="h-4 w-4" />
      </button>

      {/* Popover */}
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 min-w-[220px] bg-[var(--color-bg-surface)] border-2 border-[var(--color-border-heavy)]"
          role="dialog"
          aria-label={t('settings')}
        >
          {/* Language — always visible */}
          <div className={ROW}>
            <span className={LABEL}>{t('language')}</span>
            <LanguageSwitcher />
          </div>

          {/* View Mode — conditional */}
          {showViewMode && (
            <div className={ROW}>
              <span className={LABEL}>{t('view_mode')}</span>
              <ViewModeDropdown />
            </div>
          )}

          {/* Dark Mode — always visible */}
          <div className={ROW}>
            <span className={LABEL}>{darkMode ? (t('light_mode') || 'Light Mode') : (t('dark_mode') || 'Dark Mode')}</span>
            <DarkModeToggle />
          </div>

          {/* Accessibility toggles — conditional */}
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

          {/* Notifications — conditional */}
          {showNotifications && (
            <div className={ROW}>
              <span className={LABEL}>{t('notifications')}</span>
              <NotificationToggle />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

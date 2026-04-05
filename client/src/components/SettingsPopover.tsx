import { useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { useT } from '../i18n';
import LanguageSwitcher from './LanguageSwitcher';
import DarkModeToggle from './DarkModeToggle';
import AccessibilityMenu from './AccessibilityMenu';
import NotificationToggle from './NotificationToggle';
import NeuroToggle from './NeuroToggle';
import ViewModeDropdown from './support/ViewModeDropdown';

export interface SettingsPopoverProps {
  showAccessibility?: boolean;
  showNotifications?: boolean;
  showBionicText?: boolean;
  showViewMode?: boolean;
}

const ROW = 'flex items-center justify-between gap-4 px-3 py-2 border-b border-[var(--color-border)] last:border-b-0';
const LABEL = 'text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-primary)] shrink-0';

export default function SettingsPopover({
  showAccessibility = false,
  showNotifications = false,
  showBionicText = false,
  showViewMode = false,
}: SettingsPopoverProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
        className="w-8 h-8 flex items-center justify-center border border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-[var(--color-accent-blue)] hover:text-white"
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
            <span className={LABEL}>{t('dark_mode')}</span>
            <DarkModeToggle />
          </div>

          {/* Accessibility — conditional */}
          {showAccessibility && (
            <div className={ROW}>
              <span className={LABEL}>{t('accessibility')}</span>
              <AccessibilityMenu />
            </div>
          )}

          {/* Bionic Text — conditional */}
          {showBionicText && (
            <div className={ROW}>
              <span className={LABEL}>{t('bionic_text')}</span>
              <NeuroToggle />
            </div>
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

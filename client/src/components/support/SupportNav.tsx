import useStore from '../../store/useStore';
import { useT } from '../../i18n';
import StatusPicker from '../StatusPicker';
import SettingsPopover from '../SettingsPopover';
import UserMenu from '../UserMenu';
import { OnlineSupport } from '../../types';

interface SupportNavProps {
  partnerName: string;
  logoUrl?: string;
  onToggleSidebar: () => void;
}

export default function SupportNav({ partnerName, onToggleSidebar }: SupportNavProps) {
  const user = useStore((s) => s.user);
  const focusMode = useStore((s) => s.focusMode);
  const onlineSupportUsers = useStore((s) => s.onlineSupportUsers) as OnlineSupport[];
  const availableCount = onlineSupportUsers.filter((u) => u.status === 'online').length;
  const totalOnline = onlineSupportUsers.length;
  const t = useT();

  if (!user) return null;

  return (
    <nav
      className={`px-8 flex items-center justify-between sticky top-0 z-50 border-b border-[var(--color-border)] ${
        focusMode ? 'py-2 bg-[var(--color-text-primary)] text-[var(--color-bg-base)]' : 'py-4 bg-[var(--color-bg-surface)]'
      }`}
    >
      {/* Left side: hamburger + TESSERA + SUPPORT + partner name */}
      <div className="flex items-center gap-4">
        {!focusMode && (
          <button
            onClick={onToggleSidebar}
            className="p-1.5 hover:bg-[var(--color-accent-blue)] hover:text-white"
            aria-label={t('queue')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
        <span className="font-bold text-2xl uppercase tracking-tighter">TESSERA</span>
        {!focusMode && (
          <>
            <span className="text-[10px] bg-[var(--color-text-primary)] text-[var(--color-bg-base)] px-2.5 py-1 font-bold uppercase tracking-wide font-mono">
              {t('support')}
            </span>
            <div className="h-6 w-px bg-[var(--color-border)]" />
            <span className="text-sm font-bold uppercase tracking-wide font-mono">{partnerName}</span>
          </>
        )}
      </div>

      {/* Right side: status + capacity + Ctrl+K + gear + avatar */}
      <div className="flex items-center gap-4">
        <StatusPicker />

        {totalOnline > 0 && !focusMode && (
          <span className="text-[9px] font-mono font-bold text-[var(--color-text-muted)]">
            {availableCount} / {totalOnline}
          </span>
        )}

        {!focusMode && (
          <kbd className="text-[9px] font-mono px-1.5 py-0.5 border border-[var(--color-border)] text-[var(--color-text-muted)] select-none cursor-default" title={t('cmd_palette_title') || 'Command Palette'}>
            Ctrl+K
          </kbd>
        )}

        <SettingsPopover
          showAccessibility
          showNotifications
          showBionicText
          showViewMode
        />
        <UserMenu showSecurity />
      </div>
    </nav>
  );
}

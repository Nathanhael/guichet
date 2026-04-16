import useStore from '../../store/useStore';
import { useT } from '../../i18n';
import { APP_NAME } from '../../constants';
import StatusPicker from '../StatusPicker';
import PartnerSwitcher from '../PartnerSwitcher';
import SettingsPopover from '../SettingsPopover';
import UserMenu from '../UserMenu';
import type { OnlineSupport } from '../../types';

interface SupportNavProps {
  partnerName: string;
}

export default function SupportNav({ partnerName }: SupportNavProps) {
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
        focusMode ? 'py-2 bg-bg-base border-border' : 'py-4 bg-[var(--color-bg-surface)]'
      }`}
    >
      {/* Left side: hamburger + brand + SUPPORT + partner name */}
      <div className="flex items-center gap-2">
        <img src="/icon-blue.svg" className="w-5 h-5 mr-1" alt="" />
        <span className="text-[13px] font-mono font-bold uppercase tracking-[3px] text-[var(--color-text-primary)]">{APP_NAME}</span>
        {!focusMode && (
          <>
            <span className="text-[10px] bg-[var(--color-text-primary)] text-[var(--color-bg-base)] px-2.5 py-1 font-bold uppercase tracking-wide font-mono ml-2">
              {t('support')}
            </span>
            <div className="h-6 w-px bg-[var(--color-border)] mx-2" />
            <span className="text-sm font-bold uppercase tracking-wide font-mono">{partnerName}</span>
          </>
        )}
      </div>

      {/* Right side: partner switcher + status + capacity + Ctrl+K + gear + avatar */}
      <div className="flex items-center gap-4">
        {/* Confirm on switch: SupportView keeps active chat tabs with open
            compose state held in component memory. Flipping tenants reconnects
            the socket and drops those tabs, so warn first. */}
        {!focusMode && <PartnerSwitcher confirmBeforeSwitch />}
        <StatusPicker />

        {totalOnline > 0 && !focusMode && (
          <span className="text-[9px] font-mono font-bold text-[var(--color-text-muted)]">
            {availableCount} / {totalOnline}
          </span>
        )}

        {!focusMode && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('support:open-palette'))}
            className="text-[9px] font-mono px-1.5 py-0.5 border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-muted)] select-none cursor-pointer bg-transparent"
            title={t('cmd_palette_title') || 'Command Palette'}
            aria-label={t('cmd_palette_title') || 'Command Palette'}
          >
            Ctrl+K
          </button>
        )}

        <SettingsPopover
          showAccessibility
          showNotifications
        />
        <UserMenu showSecurity />
      </div>
    </nav>
  );
}

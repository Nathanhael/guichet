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
      className={`px-6 flex items-center justify-between sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] ${
        focusMode ? 'py-2' : 'py-3'
      }`}
    >
      {/* Left: GUICHET | SUPPORT | partner name */}
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-[15px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">{APP_NAME}</span>
        {!focusMode && (
          <>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
              {t('support')}
            </span>
            <span className="h-5 w-px bg-[var(--color-border)]" />
            <span className="text-[13px] font-medium text-[var(--color-ink-soft)] truncate">{partnerName}</span>
          </>
        )}
      </div>

      {/* Right: partner switcher + status + capacity + Ctrl+K + gear + avatar */}
      <div className="flex items-center gap-2">
        {!focusMode && <PartnerSwitcher confirmBeforeSwitch />}
        <StatusPicker />

        {totalOnline > 0 && !focusMode && (
          <span className="text-[11px] font-medium text-[var(--color-ink-muted)] tabular-nums px-1.5">
            {availableCount} / {totalOnline}
          </span>
        )}

        {!focusMode && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('support:open-palette'))}
            className="h-8 px-2 flex items-center gap-1 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors"
            title={t('cmd_palette_title') || 'Command Palette'}
            aria-label={t('cmd_palette_title') || 'Command Palette'}
          >
            <kbd className="font-mono text-[11px]">Ctrl+K</kbd>
          </button>
        )}

        <SettingsPopover showAccessibility />
        <UserMenu />
      </div>
    </nav>
  );
}

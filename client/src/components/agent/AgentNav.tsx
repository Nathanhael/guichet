import useStore from '../../store/useStore';
import { useT } from '../../i18n';
import { APP_NAME } from '../../constants';
import ConnectionStatus from '../ConnectionStatus';
import PartnerSwitcher from '../PartnerSwitcher';
import SettingsPopover from '../SettingsPopover';
import UserMenu from '../UserMenu';

interface AgentNavProps {
  partnerName: string;
  onShowFeedback: () => void;
}

export default function AgentNav({
  partnerName,
  onShowFeedback,
}: AgentNavProps) {
  const user = useStore((s) => s.user);
  const t = useT();

  if (!user) return null;

  return (
    <nav className="relative z-50 px-6 py-3 bg-[var(--color-bg-surface)] border-b border-[var(--color-border)] text-[var(--color-ink)] flex items-center justify-between">
      {/* Left: GUICHET | AGENT | partner name */}
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-[15px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">{APP_NAME}</span>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          {t('agent')}
        </span>
        <span className="h-5 w-px bg-[var(--color-border)]" />
        <span className="text-[13px] font-medium text-[var(--color-ink-soft)] truncate">{partnerName}</span>
      </div>

      {/* Right: partner switcher + connection status + gear + avatar */}
      <div className="flex items-center gap-2">
        <PartnerSwitcher confirmBeforeSwitch />
        <ConnectionStatus />
        <SettingsPopover showAccessibility />
        <UserMenu showFeedback onFeedback={onShowFeedback} />
      </div>
    </nav>
  );
}

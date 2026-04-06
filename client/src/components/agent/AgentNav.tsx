import useStore from '../../store/useStore';
import { useT } from '../../i18n';
import ConnectionStatus from '../ConnectionStatus';
import SettingsPopover from '../SettingsPopover';
import UserMenu from '../UserMenu';

interface AgentNavProps {
  logoUrl?: string;
  partnerName: string;
  industry: string;
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
    <nav className="relative z-50 px-6 py-3 bg-[var(--color-bg-surface)] border-b border-[var(--color-border)] text-[var(--color-text-primary)] flex items-center justify-between">
      {/* Left side: TESSERA + AGENT + partner name */}
      <div className="flex items-center gap-3">
        <span className="font-bold text-2xl uppercase tracking-tighter">TESSERA</span>
        <span className="text-[10px] bg-[var(--color-text-primary)] text-[var(--color-bg-base)] px-2.5 py-1 font-bold uppercase tracking-wide font-mono">
          {t('agent')}
        </span>
        <div className="h-6 w-px bg-[var(--color-border)]" />
        <span className="text-sm font-bold uppercase tracking-wide font-mono">{partnerName}</span>
      </div>

      {/* Right side: connection status + gear + avatar */}
      <div className="flex items-center gap-4">
        <ConnectionStatus />
        <SettingsPopover showAccessibility showNotifications />
        <UserMenu showFeedback showSecurity onFeedback={onShowFeedback} />
      </div>
    </nav>
  );
}

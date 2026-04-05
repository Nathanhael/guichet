import useStore from '../../store/useStore';
import { useT } from '../../i18n';
import ConnectionStatus from '../ConnectionStatus';
import SettingsPopover from '../SettingsPopover';
import UserMenu from '../UserMenu';

interface AgentNavProps {
  logoUrl?: string;
  partnerName: string;
  industry: string;
  showSidebar: boolean;
  onToggleSidebar: () => void;
  onShowFeedback: () => void;
}

export default function AgentNav({
  partnerName,
  showSidebar,
  onToggleSidebar,
  onShowFeedback,
}: AgentNavProps) {
  const user = useStore((s) => s.user);
  const t = useT();

  if (!user) return null;

  return (
    <nav className="relative z-50 px-6 py-3 bg-[var(--color-bg-surface)] border-b border-[var(--color-border)] text-[var(--color-text-primary)] flex items-center justify-between">
      {/* Left side: hamburger + TESSERA + AGENT + partner name */}
      <div className="flex items-center gap-3">
        {showSidebar && (
          <button
            onClick={onToggleSidebar}
            className="p-1.5 hover:bg-[var(--color-accent-blue)] hover:text-white"
            aria-label={t('my_tickets')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
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

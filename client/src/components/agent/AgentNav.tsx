import useStore from '../../store/useStore';
import { useT } from '../../i18n';
import ConnectionStatus from '../ConnectionStatus';
import NavToolbar from '../NavToolbar';

interface AgentNavProps {
  logoUrl?: string;
  partnerName: string;
  industry: string;
  showSidebar: boolean;
  onToggleSidebar: () => void;
  onShowFeedback: () => void;
}

/**
 * Top navigation bar for AgentView.
 * Contains: sidebar toggle, logo/industry, user name, connection status,
 * toolbar (lang/dark/notifications), feedback button, sign-out.
 */
export default function AgentNav({
  logoUrl,
  partnerName,
  industry,
  showSidebar,
  onToggleSidebar,
  onShowFeedback,
}: AgentNavProps) {
  const user = useStore((s) => s.user);
  const logout = useStore((s) => s.logout);
  const t = useT();

  if (!user) return null;

  return (
    <nav className="relative z-50 px-6 py-3 bg-brand-900/95 backdrop-blur-md border-b border-brand-800 text-white flex items-center justify-between shadow-lg">
      <div className="flex items-center gap-3">
        {showSidebar && (
          <button
            onClick={onToggleSidebar}
            className="p-1.5 hover:bg-white/10 transition-colors"
            aria-label={t('my_tickets')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
        {logoUrl ? (
          <img src={logoUrl} alt={partnerName} className="h-8 object-contain" />
        ) : (
          <span className="text-xl font-bold tracking-tight">{industry} Support</span>
        )}
        <span className="text-xs px-2.5 py-1 rounded-md bg-brand-800 border border-brand-700 font-semibold tracking-wide">
          Agent
        </span>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm font-medium text-ui-base2">{user.name}</span>
        <ConnectionStatus />

        <NavToolbar />

        <button
          onClick={onShowFeedback}
          className="text-ui-base1 hover:text-white text-sm flex items-center gap-1.5 ml-2 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
          title={t('feedback')}
          aria-label={t('feedback')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
          {t('feedback')}
        </button>
        <button
          onClick={logout}
          aria-label={t('sign_out')}
          className="text-ui-base1 hover:text-rose-400 text-sm font-medium ml-2 transition-colors"
        >
          {t('sign_out')}
        </button>
      </div>
    </nav>
  );
}

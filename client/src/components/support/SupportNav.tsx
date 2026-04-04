import useStore from '../../store/useStore';
import { useT } from '../../i18n';
import NavToolbar from '../NavToolbar';
import NeuroToggle from '../NeuroToggle';
import StatusPicker from '../StatusPicker';
import ViewModeDropdown from './ViewModeDropdown';
import { OnlineSupport } from '../../types';

interface SupportNavProps {
  partnerName: string;
  logoUrl?: string;
  onToggleSidebar: () => void;
}

/**
 * Top navigation bar for SupportView.
 * Contains: TESSERA brand, partner logo, user name, status picker,
 * toolbar (lang/focus/neuro/dark/notifications), sign-out.
 */
export default function SupportNav({ partnerName, logoUrl, onToggleSidebar }: SupportNavProps) {
  const user = useStore((s) => s.user);
  const logout = useStore((s) => s.logout);
  const focusMode = useStore((s) => s.focusMode);
  const toggleFocusMode = useStore((s) => s.toggleFocusMode);
  const onlineSupportUsers = useStore((s) => s.onlineSupportUsers) as OnlineSupport[];
  const availableCount = onlineSupportUsers.filter((u) => u.status === 'available').length;
  const totalOnline = onlineSupportUsers.length;
  const t = useT();

  if (!user) return null;

  return (
    <nav
      className={`px-8 flex items-center justify-between sticky top-0 z-50 border-b border-[var(--color-border)] ${
        focusMode ? 'py-2 bg-[var(--color-text-primary)] text-[var(--color-bg-base)]' : 'py-4 bg-[var(--color-bg-surface)]'
      }`}
    >
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
          <div className="flex items-center gap-3">
            <div className="h-6 w-px bg-[var(--color-border)]" />
            {logoUrl ? (
              <img src={logoUrl} alt={partnerName} className="h-8 object-contain" />
            ) : (
              <span className="mono-label px-3 py-1 bg-[var(--color-text-primary)] text-[var(--color-bg-base)]">
                {partnerName}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-6">
        {!focusMode && (
          <div className="flex items-center gap-2 px-4 py-1.5 border border-[var(--color-border)] font-bold uppercase text-[10px]">
            {user.name}
          </div>
        )}

        <StatusPicker />

        {totalOnline > 0 && (
          <div className="flex items-center gap-2 px-2">
            <span className="text-[9px] font-mono font-bold uppercase text-text-muted">{t('team_capacity')}</span>
            <span className="bg-bg-elevated border border-border px-2 py-0.5 text-[11px] font-bold text-accent-green">
              {availableCount} / {totalOnline}
            </span>
          </div>
        )}

        <NavToolbar>
          <ViewModeDropdown />
          <button
            onClick={toggleFocusMode}
            aria-label={focusMode ? t('exit_focus') : t('enter_focus')}
            className={`w-8 h-8 flex items-center justify-center ${
              focusMode
                ? 'bg-[var(--color-bg-base)] text-[var(--color-text-primary)]'
                : 'hover:bg-[var(--color-accent-blue)] hover:text-white'
            }`}
          >
            Z
          </button>
          <NeuroToggle />
        </NavToolbar>

        <button
          onClick={logout}
          className="text-[var(--color-text-primary)] hover:line-through text-xs font-bold uppercase tracking-wide"
        >
          {t('sign_out')}
        </button>
      </div>
    </nav>
  );
}

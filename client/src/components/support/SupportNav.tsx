import useStore from '../../store/useStore';
import { useT } from '../../i18n';
import NavToolbar from '../NavToolbar';
import NeuroToggle from '../NeuroToggle';
import StatusPicker from '../StatusPicker';

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
  const t = useT();

  if (!user) return null;

  return (
    <nav
      className={`px-8 flex items-center justify-between sticky top-0 z-50 border-b-2 border-black dark:border-white ${
        focusMode ? 'py-2 bg-black text-white' : 'py-4 bg-white dark:bg-black'
      }`}
    >
      <div className="flex items-center gap-4">
        {!focusMode && (
          <button
            onClick={onToggleSidebar}
            className="p-1.5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            aria-label={t('queue')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
        <span className="font-black text-2xl uppercase tracking-tighter">TESSERA</span>
        {!focusMode && (
          <div className="flex items-center gap-3">
            <div className="h-6 w-px bg-black dark:bg-white opacity-20" />
            {logoUrl ? (
              <img src={logoUrl} alt={partnerName} className="h-8 object-contain" />
            ) : (
              <span className="text-[10px] font-black px-3 py-1 uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black">
                {partnerName}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-6">
        {!focusMode && (
          <div className="flex items-center gap-2 px-4 py-1.5 border-2 border-black dark:border-white bg-white dark:bg-black font-black uppercase text-[10px]">
            {user.name}
          </div>
        )}

        <StatusPicker />

        <NavToolbar>
          <button
            onClick={toggleFocusMode}
            aria-label={focusMode ? t('exit_focus') : t('enter_focus')}
            className={`w-8 h-8 flex items-center justify-center ${
              focusMode
                ? 'bg-white text-black invert'
                : 'text-white dark:text-black hover:bg-white dark:hover:bg-black hover:text-black dark:hover:text-white'
            }`}
          >
            Z
          </button>
          <NeuroToggle />
        </NavToolbar>

        <button
          onClick={logout}
          className="text-black dark:text-white hover:line-through text-xs font-black uppercase tracking-widest"
        >
          {t('sign_out')}
        </button>
      </div>
    </nav>
  );
}

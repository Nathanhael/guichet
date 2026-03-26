import useStore from '../store/useStore';
import { useT } from '../i18n';

/**
 * Shared notification bell toggle used in both AgentView and SupportView navbars.
 * Renders an SVG bell (filled when on, outline when muted).
 */
export default function NotificationToggle() {
  const notificationsEnabled = useStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useStore((s) => s.setNotificationsEnabled);
  const t = useT();

  return (
    <button
      onClick={() => setNotificationsEnabled(!notificationsEnabled)}
      title={notificationsEnabled ? t('notifications_on') : t('enable_notifications')}
      aria-label={notificationsEnabled ? t('mute_notifications') : t('enable_notifications')}
      className={`p-2 flex items-center justify-center ${
        notificationsEnabled
          ? 'text-accent-blue bg-bg-elevated'
          : 'text-text-muted hover:text-text-primary'
      }`}
    >
      {notificationsEnabled ? (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      )}
    </button>
  );
}

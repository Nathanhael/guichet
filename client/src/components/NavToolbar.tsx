import LanguageSwitcher from './LanguageSwitcher';
import DarkModeToggle from './DarkModeToggle';
import NotificationToggle from './NotificationToggle';

interface NavToolbarProps {
  /** Extra toggle buttons inserted between DarkModeToggle and NotificationToggle */
  children?: React.ReactNode;
}

/**
 * Shared toolbar strip used in both AgentView and SupportView navbars.
 * Contains LanguageSwitcher + DarkModeToggle + optional extras + NotificationToggle.
 */
export default function NavToolbar({ children }: NavToolbarProps) {
  return (
    <div className="flex items-center gap-2 bg-bg-elevated p-1 border border-border">
      <LanguageSwitcher />
      <DarkModeToggle />
      {children}
      <NotificationToggle />
    </div>
  );
}

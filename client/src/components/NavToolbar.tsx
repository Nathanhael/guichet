import { Suspense, lazy, useState } from 'react';
import LanguageSwitcher from './LanguageSwitcher';
import DarkModeToggle from './DarkModeToggle';
import AccessibilityMenu from './AccessibilityMenu';
import NotificationToggle from './NotificationToggle';
import { Shield } from 'lucide-react';

const UserSecurityModal = lazy(() => import('./UserSecurityModal'));

interface NavToolbarProps {
  /** Extra toggle buttons inserted between DarkModeToggle and NotificationToggle */
  children?: React.ReactNode;
}

/**
 * Shared toolbar strip used in both AgentView and SupportView navbars.
 * Contains LanguageSwitcher + DarkModeToggle + optional extras + NotificationToggle + Security.
 */
export default function NavToolbar({ children }: NavToolbarProps) {
  const [securityOpen, setSecurityOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2 bg-bg-elevated p-1 border border-border">
        <LanguageSwitcher />
        <DarkModeToggle />
        <AccessibilityMenu />
        {children}
        <NotificationToggle />
        <button
          onClick={() => setSecurityOpen(true)}
          title="Account Security"
          aria-label="Account Security"
          className="w-8 h-8 flex items-center justify-center hover:bg-[var(--color-accent-blue)] hover:text-white"
        >
          <Shield className="h-4 w-4" />
        </button>
      </div>

      {securityOpen && (
        <Suspense fallback={null}>
          <UserSecurityModal onClose={() => setSecurityOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

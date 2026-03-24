import { Suspense, useEffect, useState, lazy } from 'react';
import useStore from './store/useStore';
import { useSocket } from './hooks/useSocket';
import { useTheme } from './hooks/useTheme';
import { initTitleBadgeListener } from './utils/notifications';
import LoginView from './views/LoginView';
import SupportView from './views/SupportView';
import AdminView from './views/AdminView';
import PlatformView from './views/PlatformView';
import AgentView from './views/AgentView';
import DarkModeToggle from './components/DarkModeToggle';
import ErrorBoundary from './components/ErrorBoundary';
import { isPlatformAdmin, isTenantAdmin } from './utils/roles';
import { Shield } from 'lucide-react';

const UserSecurityModal = lazy(() => import('./components/UserSecurityModal'));

const LoadingFallback = () => (
  <div className="h-screen w-screen flex items-center justify-center bg-white dark:bg-black">
    <div className="text-[10px] font-black uppercase tracking-[0.2em]">Loading</div>
  </div>
);

function NoPartnerState() {
  const { logout } = useStore();
  return (
    <div className="h-screen flex flex-col items-center justify-center bg-white dark:bg-black text-black dark:text-white">
      <div className="text-center max-w-md px-8">
        <div className="w-16 h-16 border-4 border-black dark:border-white flex items-center justify-center mx-auto mb-6">
          <span className="text-2xl font-black">!</span>
        </div>
        <h1 className="text-2xl font-black uppercase tracking-tighter mb-2">No Partner Available</h1>
        <p className="text-sm font-bold uppercase opacity-60 tracking-widest mb-8">
          Your account is not assigned to any active partner. Contact your administrator.
        </p>
        <div className="flex items-center justify-center gap-4">
          <DarkModeToggle />
          <button
            onClick={logout}
            className="px-6 py-3 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black transition-all"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { user, memberships, activeMembershipId, setActiveMembershipId } = useStore();
  const [securityOpen, setSecurityOpen] = useState(false);

  useTheme();
  useSocket();

  // Initialize tab title badge listener (clears badge on window focus)
  useEffect(() => { initTitleBadgeListener(); }, []);

  // Auto-clear stale activeMembershipId for non-platform users
  useEffect(() => {
    if (!user || !activeMembershipId || user.isPlatformOperator) return;
    const found = (memberships || []).find(m => m.id === activeMembershipId);
    if (!found) setActiveMembershipId(null);
  }, [user, activeMembershipId, memberships, setActiveMembershipId]);

  const renderView = () => {
    if (!user) return <LoginView />;

    // If user is Platform Operator, show Platform View by default
    if (isPlatformAdmin(user) && !activeMembershipId) {
      return (
        <ErrorBoundary>
          <Suspense fallback={<LoadingFallback />}>
            <PlatformView />
          </Suspense>
        </ErrorBoundary>
      );
    }

    const activeMembership = (memberships || []).find(m => m.id === activeMembershipId);
    const role = activeMembership?.role;

    // Non-platform user with no valid membership — show unavailable state
    if (!isPlatformAdmin(user) && !activeMembership) {
      return <NoPartnerState />;
    }

    // Platform Operators get Admin access to any partner they 'Enter'
    if (isPlatformAdmin(user) || isTenantAdmin(role)) {
      return (
        <ErrorBoundary>
          <Suspense fallback={<LoadingFallback />}>
            <AdminView />
          </Suspense>
        </ErrorBoundary>
      );
    }

    // End-user / customer agent view
    if (role === 'agent') {
      return (
        <ErrorBoundary>
          <Suspense fallback={<LoadingFallback />}>
            <AgentView />
          </Suspense>
        </ErrorBoundary>
      );
    }

    // Support staff view
    return (
      <ErrorBoundary>
        <Suspense fallback={<LoadingFallback />}>
          <SupportView />
        </Suspense>
      </ErrorBoundary>
    );
  };

  const dyslexicMode = useStore((s) => s.dyslexicMode);

  return (
    <div>
      <div className={dyslexicMode ? 'dyslexic-mode' : ''}>
        {renderView()}

        {/* Global security settings trigger (visible when logged in) */}
        {user && (
          <button
            onClick={() => setSecurityOpen(true)}
            title="Account Security"
            className="fixed bottom-6 right-6 z-50 w-10 h-10 border-2 border-black dark:border-white bg-white dark:bg-black flex items-center justify-center hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black transition-colors"
          >
            <Shield className="h-4 w-4" />
          </button>
        )}

        {securityOpen && (
          <Suspense fallback={null}>
            <UserSecurityModal onClose={() => setSecurityOpen(false)} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

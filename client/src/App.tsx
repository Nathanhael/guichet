import { Suspense, useEffect, useState, lazy } from 'react';
import useStore, { useStoreShallow } from './store/useStore';
import { useSocket } from './hooks/useSocket';
import { useTheme } from './hooks/useTheme';
import { useTokenRefresh } from './hooks/useTokenRefresh';
import { initTitleBadgeListener } from './utils/notifications';
import DarkModeToggle from './components/DarkModeToggle';
import ErrorBoundary from './components/ErrorBoundary';
import { isPlatformAdmin, isTenantAdmin } from './utils/roles';
import { Shield } from 'lucide-react';

const LoginView = lazy(() => import('./views/LoginView'));
const SupportView = lazy(() => import('./views/SupportView'));
const AdminView = lazy(() => import('./views/AdminView'));
const PlatformView = lazy(() => import('./views/PlatformView'));
const AgentView = lazy(() => import('./views/AgentView'));
const UserSecurityModal = lazy(() => import('./components/UserSecurityModal'));

const LoadingFallback = () => (
  <div className="h-screen w-screen flex items-center justify-center bg-[var(--color-bg-base)]">
    <div className="mono-label text-[10px]">Loading</div>
  </div>
);

function NoPartnerState() {
  const logout = useStore((s) => s.logout);
  return (
    <div className="h-screen flex flex-col items-center justify-center bg-[var(--color-bg-base)] text-[var(--color-text-primary)]">
      <div className="text-center max-w-md px-8">
        <div className="w-16 h-16 border border-[var(--color-border-heavy)] flex items-center justify-center mx-auto mb-6">
          <span className="text-2xl font-bold">!</span>
        </div>
        <h1 className="text-2xl font-bold uppercase tracking-tighter mb-2">No Partner Available</h1>
        <p className="text-sm font-mono font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-8">
          Your account is not assigned to any active partner. Contact your administrator.
        </p>
        <div className="flex items-center justify-center gap-4">
          <DarkModeToggle />
          <button
            onClick={logout}
            className="btn-secondary px-6 py-3 text-[10px] mono-label"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { user, memberships, activeMembershipId, setActiveMembershipId } = useStoreShallow((s) => ({
    user: s.user,
    memberships: s.memberships,
    activeMembershipId: s.activeMembershipId,
    setActiveMembershipId: s.setActiveMembershipId,
  }));
  const [securityOpen, setSecurityOpen] = useState(false);

  useTheme();
  useSocket();
  useTokenRefresh();

  // Initialize tab title badge listener (clears badge on window focus)
  useEffect(() => { initTitleBadgeListener(); }, []);

  // Auto-clear stale activeMembershipId for non-platform users
  useEffect(() => {
    if (!user || !activeMembershipId || user.isPlatformOperator) return;
    const found = (memberships || []).find(m => m.id === activeMembershipId);
    if (!found) setActiveMembershipId(null);
  }, [user, activeMembershipId, memberships, setActiveMembershipId]);

  const renderView = () => {
    if (!user) return <ErrorBoundary><Suspense fallback={<LoadingFallback />}><LoginView /></Suspense></ErrorBoundary>;

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
    <div className="h-full">
      <div className={`h-full ${dyslexicMode ? 'dyslexic-mode' : ''}`}>
        {renderView()}

        {/* Global security settings trigger (visible when logged in) */}
        {user && (
          <button
            onClick={() => setSecurityOpen(true)}
            title="Account Security"
            className="fixed bottom-6 right-6 z-50 w-10 h-10 border border-[var(--color-border-heavy)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] flex items-center justify-center hover:bg-[var(--color-accent-blue)] hover:text-white hover:border-[var(--color-accent-blue)]"
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

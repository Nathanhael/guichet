import { Suspense, useEffect, lazy } from 'react';
import useStore, { useStoreShallow } from './store/useStore';
import { useSocket } from './hooks/useSocket';
import { useTheme } from './hooks/useTheme';
import { useTokenRefresh } from './hooks/useTokenRefresh';
import { initTitleBadgeListener } from './utils/notifications';
import DarkModeToggle from './components/DarkModeToggle';
import ErrorBoundary from './components/ErrorBoundary';
import Button from './components/ui/Button';
import { ImageLightbox } from './components/chat';
import { isPlatformAdmin, isTenantAdmin } from './utils/roles';

const LoginView = lazy(() => import('./views/LoginView'));
const SupportView = lazy(() => import('./views/SupportView'));
const AdminView = lazy(() => import('./views/AdminView'));
const PlatformView = lazy(() => import('./views/PlatformView'));
const AgentView = lazy(() => import('./views/AgentView'));

const LoadingFallback = () => (
  <div className="h-screen w-screen flex items-center justify-center bg-[var(--color-bg-base)]">
    <div className="flex flex-col items-center gap-3">
      <div className="h-6 w-6 rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin" />
      <p className="text-[12px] text-[var(--color-ink-muted)]">Loading</p>
    </div>
  </div>
);

function NoPartnerState() {
  const logout = useStore((s) => s.logout);
  return (
    <div className="h-screen flex flex-col items-center justify-center bg-[var(--color-bg-base)] text-[var(--color-ink)]">
      <div className="text-center max-w-md px-8">
        <div className="w-14 h-14 rounded-full bg-[var(--color-urgent-soft)] flex items-center justify-center mx-auto mb-5">
          <span className="text-2xl text-[var(--color-urgent)]">!</span>
        </div>
        <h1 className="text-[22px] font-semibold tracking-[-0.2px] mb-2">No partner available</h1>
        <p className="text-[13px] text-[var(--color-ink-muted)] mb-8 leading-relaxed">
          Your account is not assigned to any active partner. Contact your administrator.
        </p>
        <div className="flex items-center justify-center gap-3">
          <DarkModeToggle />
          <Button variant="secondary" size="md" onClick={logout}>
            Sign Out
          </Button>
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
  useTheme();
  useSocket();
  useTokenRefresh();

  useEffect(() => { initTitleBadgeListener(); }, []);

  useEffect(() => {
    if (!user || !activeMembershipId || user.isPlatformOperator) return;
    const found = (memberships || []).find(m => m.id === activeMembershipId);
    if (!found) setActiveMembershipId(null);
  }, [user, activeMembershipId, memberships, setActiveMembershipId]);

  const renderView = () => {
    if (!user) return <ErrorBoundary><Suspense fallback={<LoadingFallback />}><LoginView /></Suspense></ErrorBoundary>;

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

    if (!isPlatformAdmin(user) && !activeMembership) {
      return <NoPartnerState />;
    }

    if (isPlatformAdmin(user) || isTenantAdmin(role)) {
      return (
        <ErrorBoundary>
          <Suspense fallback={<LoadingFallback />}>
            <AdminView />
          </Suspense>
        </ErrorBoundary>
      );
    }

    if (role === 'agent') {
      return (
        <ErrorBoundary>
          <Suspense fallback={<LoadingFallback />}>
            <AgentView />
          </Suspense>
        </ErrorBoundary>
      );
    }

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
        <ImageLightbox />
      </div>
    </div>
  );
}

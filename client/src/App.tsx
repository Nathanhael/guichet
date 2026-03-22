import { Suspense, useEffect } from 'react';
import useStore from './store/useStore';
import { useSocket } from './hooks/useSocket';
import { useTheme } from './hooks/useTheme';
import LoginView from './views/LoginView';
import SupportView from './views/SupportView';
import AdminView from './views/AdminView';
import PlatformView from './views/PlatformView';
import AgentView from './views/AgentView';
import DarkModeToggle from './components/DarkModeToggle';

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

  useTheme();
  useSocket();

  // Auto-clear stale activeMembershipId for non-platform users
  useEffect(() => {
    if (!user || !activeMembershipId || user.isPlatformOperator) return;
    const found = (memberships || []).find(m => m.id === activeMembershipId);
    if (!found) setActiveMembershipId(null);
  }, [user, activeMembershipId, memberships, setActiveMembershipId]);

  const renderView = () => {
    if (!user) return <LoginView />;

    // If user is Platform Operator, show Platform View by default
    if (user.isPlatformOperator && !activeMembershipId) {
      return (
        <Suspense fallback={<LoadingFallback />}>
          <PlatformView />
        </Suspense>
      );
    }

    const activeMembership = (memberships || []).find(m => m.id === activeMembershipId);
    const role = activeMembership?.role;

    // Non-platform user with no valid membership — show unavailable state
    if (!user.isPlatformOperator && !activeMembership) {
      return <NoPartnerState />;
    }

    // Platform Operators get Admin access to any partner they 'Enter'
    if (user.isPlatformOperator || role === 'admin') {
      return (
        <Suspense fallback={<LoadingFallback />}>
          <AdminView />
        </Suspense>
      );
    }

    // End-user / customer agent view
    if (role === 'agent') {
      return (
        <Suspense fallback={<LoadingFallback />}>
          <AgentView />
        </Suspense>
      );
    }

    // Support staff view
    return (
      <Suspense fallback={<LoadingFallback />}>
        <SupportView />
      </Suspense>
    );
  };

  const dyslexicMode = useStore((s) => s.dyslexicMode);

  return (
    <div>
      <div className={dyslexicMode ? 'dyslexic-mode' : ''}>
        {renderView()}
      </div>
    </div>
  );
}

import { lazy, Suspense } from 'react';
import useStore from './store/useStore';
import { useSocket } from './hooks/useSocket';
import { useTheme } from './hooks/useTheme';
import LoginView from './views/LoginView';

const SupportView = lazy(() => import('./views/SupportView'));
const AdminView = lazy(() => import('./views/AdminView'));
const PlatformView = lazy(() => import('./views/PlatformView'));

const LoadingFallback = () => (
  <div className="h-screen w-screen flex items-center justify-center bg-white dark:bg-black">
    <div className="text-[10px] font-black uppercase tracking-[0.2em]">Loading</div>
  </div>
);

export default function App() {
  const { user, memberships, activeMembershipId } = useStore();

  useTheme();
  useSocket();

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

    const activeMembership = memberships.find(m => m.id === activeMembershipId);
    const role = activeMembership?.role;

    if (role === 'admin' || role === 'manager') {
      return (
        <Suspense fallback={<LoadingFallback />}>
          <AdminView />
        </Suspense>
      );
    }

    return (
      <Suspense fallback={<LoadingFallback />}>
        <SupportView />
      </Suspense>
    );
  };

  const darkMode = useStore((s) => s.darkMode);
  const dyslexicMode = useStore((s) => s.dyslexicMode);

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className={dyslexicMode ? 'dyslexic-mode' : ''}>
        {renderView()}
      </div>
    </div>
  );
}

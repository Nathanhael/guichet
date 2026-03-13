import { useEffect, lazy, Suspense } from 'react';
import useStore from './store/useStore';
import { useSocket } from './hooks/useSocket';
import LoginView from './views/LoginView';
import { WifiOff, AlertCircle, Loader2 } from 'lucide-react';

// Lazy load large view components
const AgentView = lazy(() => import('./views/AgentView'));
const SupportView = lazy(() => import('./views/SupportView'));
const AdminView = lazy(() => import('./views/AdminView'));
const PlatformView = lazy(() => import('./views/PlatformView'));

function LoadingFallback() {
  return (
    <div className="min-h-screen bg-solarized-base3 dark:bg-solarized-base03 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-10 h-10 text-solarized-blue animate-spin" />
        <p className="text-solarized-base01 dark:text-solarized-base1 font-medium animate-pulse">
          Loading workspace...
        </p>
      </div>
    </div>
  );
}

function ConnectionBanner() {
  const { connectionStatus } = useStore();

  if (connectionStatus === 'connected') return null;

  return (
    <div className={`fixed top-0 left-0 right-0 z-[100] py-1.5 px-4 flex items-center justify-center gap-2 text-xs font-bold text-white shadow-md transition-colors ${connectionStatus === 'reconnecting' ? 'bg-amber-500' : 'bg-red-500'
      }`}>
      {connectionStatus === 'reconnecting' ? (
        <>
          <AlertCircle size={14} className="animate-pulse" />
          <span>Reconnecting to server...</span>
        </>
      ) : (
        <>
          <WifiOff size={14} />
          <span>Connection lost. Retrying...</span>
        </>
      )}
    </div>
  );
}

export default function App() {
  const { user, darkMode, dyslexicMode, highContrastMode, setAppConfig, memberships, activeMembershipId } = useStore();
  
  useSocket();

  // Dynamic Theming
  useEffect(() => {
    const activeMembership = memberships.find(m => m.id === activeMembershipId);
    if (activeMembership?.manifest) {
      const { primaryColor, secondaryColor } = activeMembership.manifest;
      document.documentElement.style.setProperty('--brand-primary', primaryColor);
      document.documentElement.style.setProperty('--brand-secondary', secondaryColor);
      // Update Tailwind-compatible RGB if needed, but for now hex is fine for basic vars
    }
  }, [memberships, activeMembershipId]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  useEffect(() => {
    if (dyslexicMode) {
      document.documentElement.classList.add('dyslexic-mode');
    } else {
      document.documentElement.classList.remove('dyslexic-mode');
    }
  }, [dyslexicMode]);

  useEffect(() => {
    if (highContrastMode) {
      document.documentElement.classList.add('high-contrast-mode');
    } else {
      document.documentElement.classList.remove('high-contrast-mode');
    }
  }, [highContrastMode]);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((config) => setAppConfig(config))
      .catch((err) => console.error('Failed to load app config:', err));
  }, [setAppConfig]);

  const renderView = () => {
    if (!user) return <LoginView />;
    
    // Determine active role based on membership
    const { memberships, activeMembershipId } = useStore.getState();
    const activeMembership = memberships.find(m => m.id === activeMembershipId);
    
    // If user is Platform Operator and no specific membership selected, show Platform View
    if (user.isPlatformOperator && !activeMembershipId) {
      return (
        <Suspense fallback={<LoadingFallback />}>
          <PlatformView />
        </Suspense>
      );
    }

    const role = activeMembership?.role;

    return (
      <Suspense fallback={<LoadingFallback />}>
        {role === 'agent' && <AgentView />}
        {role === 'support' && <SupportView />}
        {(role === 'admin' || role === 'manager') && <AdminView />}
      </Suspense>
    );
  };

  return (
    <>
      <ConnectionBanner />
      {renderView()}
    </>
  );
}

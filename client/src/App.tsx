import { useEffect, useState, lazy, Suspense } from 'react';
import useStore from './store/useStore';
import { useSocket } from './hooks/useSocket';
import { useTheme } from './hooks/useTheme';
import LoginView from './views/LoginView';
import { WifiOff, AlertCircle, Loader2 } from 'lucide-react';

// Lazy load large view components
const AgentView = lazy(() => import('./views/AgentView'));
const SupportView = lazy(() => import('./views/SupportView'));
const AdminView = lazy(() => import('./views/AdminView'));
const PlatformView = lazy(() => import('./views/PlatformView'));
const AgentLiteView = lazy(() => import('./views/AgentLiteView'));

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
    <div 
      data-testid="connection-banner"
      className={`fixed top-0 left-0 right-0 z-[100] py-1.5 px-4 flex items-center justify-center gap-2 text-xs font-bold text-white shadow-md transition-colors ${connectionStatus === 'reconnecting' ? 'bg-amber-500' : 'bg-red-500'
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
  const { user, darkMode, dyslexicMode, highContrastMode, setAppConfig, activePartnerId } = useStore();
  
  const [showLitePrompt, setShowLitePrompt] = useState(false);
  const isLiteMode = new URLSearchParams(window.location.search).has('lite');

  useSocket();
  useTheme();

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
    const url = activePartnerId ? `/api/v1/config?partnerId=${activePartnerId}` : '/api/v1/config';
    fetch(url)
      .then((res) => res.json())
      .then((config) => setAppConfig(config))
      .catch((err) => console.error('Failed to load app config:', err));
  }, [setAppConfig, activePartnerId]);

  // Mobile lite mode prompt
  useEffect(() => {
    const { memberships, activeMembershipId } = useStore.getState();
    const membership = memberships.find(m => m.id === activeMembershipId);
    if (membership?.role !== 'agent') return;
    if (isLiteMode) return;
    if (localStorage.getItem('liteDismissed')) return;
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (isMobile) setShowLitePrompt(true);
  }, [user, isLiteMode]);

  // Service worker registration
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // SW registration failed — app works without it
      });
    }
  }, []);

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
        {role === 'agent' && isLiteMode && <AgentLiteView />}
        {role === 'agent' && !isLiteMode && <AgentView />}
        {role === 'support' && <SupportView />}
        {(role === 'admin' || role === 'manager') && <AdminView />}
      </Suspense>
    );
  };

  return (
    <>
      <ConnectionBanner />
      {renderView()}
      {showLitePrompt && (
        <div className="fixed bottom-4 left-4 right-4 z-[9999] bg-gray-900 text-white p-4 rounded-xl shadow-2xl flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Switch to mobile view?</span>
          <div className="flex gap-2">
            <button
              onClick={() => { window.location.href = '/?lite=1'; }}
              className="bg-brand-500 px-4 py-2 rounded-lg text-sm font-bold"
            >
              Yes
            </button>
            <button
              onClick={() => { setShowLitePrompt(false); localStorage.setItem('liteDismissed', '1'); }}
              className="px-4 py-2 rounded-lg text-sm text-gray-300"
            >
              No
            </button>
          </div>
        </div>
      )}
    </>
  );
}

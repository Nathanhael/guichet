import React, { useEffect } from 'react';
import useStore from './store/useStore';
import { useSocket } from './hooks/useSocket';
import LoginView from './views/LoginView';
import AgentView from './views/AgentView';
import ExpertView from './views/ExpertView';
import AdminView from './views/AdminView';
import { WifiOff, AlertCircle } from 'lucide-react';

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
  const { user, darkMode, setAppConfig } = useStore();
  
  useSocket();

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  useEffect(() => {
    const { dyslexicMode } = useStore.getState();
    if (dyslexicMode) {
      document.documentElement.classList.add('dyslexic-mode');
    } else {
      document.documentElement.classList.remove('dyslexic-mode');
    }
  }, [useStore((s) => s.dyslexicMode)]);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((config) => setAppConfig(config))
      .catch((err) => console.error('Failed to load app config:', err));
  }, [setAppConfig]);



  const renderView = () => {
    if (!user) return <LoginView />;
    if (user.role === 'agent') return <AgentView />;
    if (user.role === 'expert') return <ExpertView />;
    if (user.role === 'admin') return <AdminView />;
    return <LoginView />;
  };

  return (
    <>
      <ConnectionBanner />
      {renderView()}
    </>
  );
}

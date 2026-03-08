import React, { useEffect } from 'react';
import useStore from './store/useStore';
import { useSocket } from './hooks/useSocket';
import LoginView from './views/LoginView';
import AgentView from './views/AgentView';
import ExpertView from './views/ExpertView';
import ManagerView from './views/ManagerView';

export default function App() {
  const { user, darkMode } = useStore();
  useSocket();

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  if (!user) return <LoginView />;
  if (user.role === 'agent') return <AgentView />;
  if (user.role === 'expert') return <ExpertView />;
  if (user.role === 'manager') return <ManagerView />;

  return <LoginView />;
}

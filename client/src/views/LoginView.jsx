import React, { useEffect, useState } from 'react';
import useStore from '../store/useStore';
import { tBrowser } from '../i18n';
import DarkModeToggle from '../components/DarkModeToggle';

const ROLE_LABEL = { agent: 'Agent', expert: 'Expert', manager: 'Manager' };
const ROLE_BADGE = {
  agent: 'bg-brand-50 text-brand-600',
  expert: 'bg-brand-100 text-brand-700',
  manager: 'bg-brand-800 text-white',
};
const LANG_FLAG = { nl: '🇧🇪 NL', fr: '🇫🇷 FR', en: '🇬🇧 EN' };

export default function LoginView() {
  const { setUser } = useStore();
  const [users, setUsers] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/users')
      .then((r) => r.json())
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter === 'all' ? users : users.filter((u) => u.role === filter);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 animate-fade-in">
      {/* Dark mode toggle top-right */}
      <div className="absolute top-4 right-4 z-50">
        <DarkModeToggle />
      </div>

      <div className="glass-card w-full max-w-lg overflow-hidden animate-slide-up relative z-10">
        <div className="bg-gradient-to-r from-brand-800 to-brand-900 px-8 py-8 text-white">
          <h1 className="text-3xl font-bold tracking-tight">iKanbi Expert Chat</h1>
          <p className="text-brand-200 text-sm mt-2 opacity-90">{tBrowser('select_user')}</p>
        </div>

        <div className="flex border-b border-gray-100 dark:border-brand-800 px-4 pt-4 bg-white/50 dark:bg-brand-900/50">
          {['all', 'agent', 'expert', 'manager'].map((role) => (
            <button
              key={role}
              onClick={() => setFilter(role)}
              className={`px-3 py-2 text-sm font-medium capitalize transition-all duration-300 border-b-2 mr-1 ${filter === role
                ? 'border-accent-500 text-accent-600 dark:text-accent-400'
                : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200'
                }`}
            >
              {role === 'all' ? tBrowser('all') : ROLE_LABEL[role]}
            </button>
          ))}
        </div>

        <div className="p-4 max-h-[28rem] overflow-y-auto scrollbar-thin bg-white/40 dark:bg-brand-900/40">
          {loading && <p className="text-center text-gray-400 py-8">{tBrowser('loading')}</p>}
          {!loading && filtered.length === 0 && (
            <p className="text-center text-gray-400 py-8">{tBrowser('no_users')}</p>
          )}
          <ul className="space-y-2">
            {filtered.map((u) => (
              <li key={u.id}>
                <button
                  onClick={() => setUser(u)}
                  className="w-full text-left p-4 rounded-xl border border-white/60 dark:border-brand-700 hover:border-accent-400 dark:hover:border-accent-500 bg-white/60 dark:bg-brand-800/60 hover:shadow-lg hover:-translate-y-1 hover:bg-white dark:hover:bg-brand-800 transition-all duration-300 group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-100 to-brand-200 dark:from-brand-600 dark:to-brand-700 flex items-center justify-center text-xl font-bold text-brand-700 dark:text-brand-100 shadow-sm group-hover:scale-105 transition-transform duration-300">
                        {u.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-800 dark:text-white">{u.name}</p>
                        <p className="text-xs text-gray-400 dark:text-slate-400">{u.dept}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_BADGE[u.role]}`}>
                        {ROLE_LABEL[u.role]}
                      </span>
                      <span className="text-xs text-gray-400">{LANG_FLAG[u.lang]}</span>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

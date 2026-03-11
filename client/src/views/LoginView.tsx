import React, { useEffect, useState } from 'react';
import useStore from '../store/useStore';
import { tBrowser } from '../i18n';
import DarkModeToggle from '../components/DarkModeToggle';
import { User, UserRole } from '../types';

const ROLE_LABEL: Record<string, string> = { agent: 'Agent', expert: 'Expert', admin: 'Admin' };
const ROLE_BADGE: Record<string, string> = {
  agent: 'bg-solarized-base2 text-solarized-base1',
  expert: 'bg-solarized-base2 text-brand-600',
  admin: 'bg-solarized-base02 text-accent-500',
  manager: 'bg-solarized-base02 text-solarized-base2',
};
const LANG_FLAG: Record<string, string> = { nl: '🇧🇪 NL', fr: '🇫🇷 FR', en: '🇬🇧 EN' };

export default function LoginView() {
  const { setUser, setToken } = useStore();
  const [users, setUsers] = useState<User[]>([]);
  const [filter, setFilter] = useState<UserRole | 'all'>('all');
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
    <div className="min-h-screen flex flex-col items-center justify-center p-6 animate-fade-in text-slate-900 dark:text-slate-100">
      {/* Dark mode toggle top-right */}
      <div className="absolute top-4 right-4 z-50">
        <DarkModeToggle />
      </div>

      <div className="glass-panel w-full max-w-lg overflow-hidden animate-slide-up relative z-10 border border-white/20 dark:border-brand-700/50 bg-white/70 dark:bg-brand-900/40 backdrop-blur-xl rounded-3xl shadow-2xl">
        <div className="bg-gradient-to-r from-brand-800 to-brand-900 px-8 py-8 text-white">
          <h1 className="text-3xl font-bold tracking-tight">iKanbi M&P Support</h1>
          <p className="text-brand-200 text-sm mt-2 opacity-90">{tBrowser('select_user')}</p>
        </div>

        <div className="flex border-b border-solarized-base2 dark:border-brand-800 px-4 pt-4 bg-solarized-base3/50 dark:bg-brand-900/50">
          {(['all', 'agent', 'expert', 'admin'] as const).map((role) => (
            <button
              key={role}
              onClick={() => setFilter(role)}
              className={`px-3 py-2 text-sm font-medium capitalize transition-all duration-300 border-b-2 mr-1 ${filter === role
                ? 'border-accent-500 text-accent-600 dark:text-accent-400'
                : 'border-transparent text-solarized-base1 dark:text-slate-400 hover:text-solarized-base01 dark:hover:text-slate-200'
                }`}
            >
              {role === 'all' ? tBrowser('all') : ROLE_LABEL[role]}
            </button>
          ))}
        </div>

        <div className="p-4 max-h-[28rem] overflow-y-auto scrollbar-thin bg-solarized-base2/40 dark:bg-brand-900/40">
          {loading && <p className="text-center text-solarized-base1 py-8">{tBrowser('loading')}</p>}
          {!loading && filtered.length === 0 && (
            <p className="text-center text-solarized-base1 py-8">{tBrowser('no_users')}</p>
          )}
          <ul className="space-y-2">
            {filtered.map((u) => (
              <li key={u.id}>
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/auth/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: u.id, password: 'password123' })
                      });
                      if (res.ok) {
                        const data = await res.json();
                        setToken(data.token);
                        setUser(data.user);
                      } else {
                        alert('Login failed. Please ensure the user has the default password.');
                      }
                    } catch (err) {
                      console.error(err);
                    }
                  }}
                  className="w-full text-left p-4 rounded-xl border border-solarized-base2 dark:border-brand-700 hover:border-accent-400 dark:hover:border-accent-500 bg-white/60 dark:bg-brand-800/60 hover:shadow-lg hover:-translate-y-1 hover:bg-white dark:hover:bg-brand-800 transition-all duration-300 group shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-solarized-base2 to-solarized-base1 dark:from-brand-600 dark:to-brand-700 flex items-center justify-center text-xl font-bold text-solarized-base00 dark:text-brand-100 shadow-inner group-hover:scale-105 transition-transform duration-300">
                        {u.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-semibold text-solarized-base01 dark:text-white">{u.name}</p>
                        <p className="text-xs text-solarized-base1 dark:text-slate-400">{u.dept}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_BADGE[u.role]}`}>
                        {ROLE_LABEL[u.role]}
                      </span>
                      <span className="text-xs text-solarized-base1 dark:text-slate-400">{LANG_FLAG[u.lang] || u.lang}</span>
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

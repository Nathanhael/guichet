import { useState } from 'react';
import useStore from '../store/useStore';
import { tBrowser } from '../i18n';
import DarkModeToggle from '../components/DarkModeToggle';
import SystemBackground from '../components/SystemBackground';
import { trpc } from '../utils/trpc';

const LANG_FLAG: Record<string, string> = { nl: '🇧🇪 NL', fr: '🇫🇷 FR', en: '🇬🇧 EN' };

export default function LoginView() {
  const { setUser, setToken } = useStore();
  const [filter, setFilter] = useState<'all' | 'platform'>('all');

  const { data: usersData, isLoading: loading } = trpc.user.list.useQuery();
  const users = (usersData || []) as any[];

  const filtered = filter === 'platform'
    ? users.filter((u: any) => u.is_platform_operator)
    : users;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 text-black dark:text-white relative bg-white dark:bg-black">
      <SystemBackground />
      
      <div className="absolute top-6 right-6 z-50">
        <DarkModeToggle />
      </div>

      <div className="w-full max-w-lg overflow-hidden relative z-10 border-2 border-black dark:border-white bg-white dark:bg-black">
        <div className="bg-black dark:bg-white px-8 py-10 text-white dark:text-black relative overflow-hidden">
          <h1 className="text-4xl font-black uppercase tracking-tighter relative z-10">Tessera</h1>
          <p className="text-sm mt-2 opacity-80 font-bold uppercase tracking-widest relative z-10">{tBrowser('select_user')}</p>
        </div>

        <div className="flex border-b-2 border-black dark:border-white px-4 pt-4 bg-white dark:bg-black overflow-x-auto no-scrollbar">
          {(['all', 'platform'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-4 py-3 text-xs font-black uppercase tracking-wider border-b-4 mr-1 shrink-0 ${filter === tab
                ? 'border-black dark:border-white text-black dark:text-white'
                : 'border-transparent opacity-40 hover:opacity-100'
                }`}
            >
              {tab === 'all' ? tBrowser('all') : 'Platform'}
            </button>
          ))}
        </div>

        <div className="p-4 max-h-[28rem] overflow-y-auto bg-white dark:bg-black">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-8 h-8 border-4 border-black dark:border-white border-t-transparent" />
              <p className="text-sm font-bold uppercase text-black dark:text-white">{tBrowser('loading')}</p>
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <p className="text-center opacity-50 py-12 font-bold uppercase">{tBrowser('no_users')}</p>
          )}
          
          <ul className="space-y-3 pb-2">
            {filtered.map((u) => (
              <li key={u.id}>
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/v1/auth/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: u.id, password: 'password123' })
                      });
                      if (res.ok) {
                        const data = await res.json();
                        setToken(data.token);
                        setUser(data.user);
                        const memberships = data.memberships || [];
                        useStore.getState().setMemberships(memberships);
                        if (memberships.length > 0 && !data.user.isPlatformOperator) {
                          useStore.getState().setActiveMembershipId(memberships[0].id);
                        }
                      }
                    } catch (err) {
                      console.error(err);
                    }
                  }}
                  className="w-full text-left p-4 border-2 border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black group flex items-center justify-between"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 border-2 border-current flex items-center justify-center text-xl font-black">
                      {u.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-black uppercase tracking-tight">{u.name}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[10px] font-black uppercase tracking-widest border border-current px-2 py-0.5">
                      {ROLE_LABEL[u.role]}
                    </span>
                    <span className="text-[10px] font-bold opacity-60">{LANG_FLAG[u.lang] || u.lang}</span>
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

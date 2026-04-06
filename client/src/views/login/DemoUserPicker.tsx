import { useState } from 'react';
import { useT } from '../../i18n';
import { trpc } from '../../utils/trpc';
import { LANG_LABEL } from '../../constants';
import { getRoleDisplayName } from '../../utils/roles';
import type { User, Membership, UserRole } from '../../types';

type DemoUser = { id: string; name: string; email?: string; role?: string; lang?: string; isPlatformOperator?: boolean; membershipId?: string | null; partnerId?: string | null; partnerName?: string | null };

interface DemoUserPickerProps {
  onLoginSuccess: (user: User, memberships: Membership[], preferredMembershipId?: string) => void;
  onMfaRequired: (endpoint: string, body: Record<string, unknown>, passwordRef: string) => void;
}

export default function DemoUserPicker({ onLoginSuccess, onMfaRequired }: DemoUserPickerProps) {
  const t = useT();
  const [filter, setFilter] = useState<'all' | 'platform' | 'support' | 'admin' | 'agent'>('all');
  const [isDemoLoading, setIsDemoLoading] = useState(false);
  const [error, setError] = useState('');

  const { data: usersData } = trpc.user.demoList.useQuery();
  const demoLoginMutation = trpc.user.demoLogin.useMutation();
  const users: DemoUser[] = usersData ? (usersData as DemoUser[]) : [];

  const filtered = filter === 'all' ? users :
    filter === 'platform' ? users.filter((u: DemoUser) => u.isPlatformOperator) :
    filter === 'support' ? users.filter((u: DemoUser) => u.role === 'support') :
    filter === 'admin' ? users.filter((u: DemoUser) => u.role === 'admin' && !u.isPlatformOperator) :
    filter === 'agent' ? users.filter((u: DemoUser) => u.role === 'agent') :
    users;

  const handleDemoLogin = async (u: DemoUser) => {
    if (isDemoLoading) return;
    setError('');
    setIsDemoLoading(true);
    try {
      const { password: demoPassword } = await demoLoginMutation.mutateAsync({ email: u.email! });
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: u.id, password: demoPassword })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.mfaRequired) {
          onMfaRequired('/api/v1/auth/login', { id: u.id }, demoPassword);
        } else {
          // Pass the membershipId from the clicked entry to auto-select the correct role
          const preferredId = u.membershipId ?? undefined;
          onLoginSuccess(data.user, data.memberships || [], preferredId);
        }
      } else {
         const errData = await res.json();
         setError(errData.error || t('login_failed'));
      }
    } catch (err) {
      console.error(err);
      setError(t('network_error'));
    } finally {
      setIsDemoLoading(false);
    }
  };

  return (
    <>
      <div className="flex border-b border-[var(--color-border-heavy)] px-4 pt-4 bg-[var(--color-bg-surface)] overflow-x-auto no-scrollbar">
        {(['all', 'platform', 'support', 'admin', 'agent'] as const).map((tab) => (
          <button key={tab} onClick={() => setFilter(tab)} className={`px-4 py-3 mono-label border-b-2 mr-1 shrink-0 ${filter === tab ? 'border-[var(--color-text-primary)] text-[var(--color-text-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'}`}>{tab === 'all' ? t('all') : tab === 'platform' ? getRoleDisplayName('platform_operator', true) : getRoleDisplayName(tab as UserRole)}</button>
        ))}
      </div>
      <div className="p-4 max-h-[30rem] overflow-y-auto bg-[var(--color-bg-surface)]">
        {error && (
          <div className="p-3 mb-3 border border-[var(--color-accent-red)] text-[var(--color-accent-red)] flex items-center gap-3">
            <span className="text-lg font-bold">!</span>
            <p className="mono-label">{error}</p>
          </div>
        )}
        {filtered.length === 0 && <p className="text-center mono-label text-[var(--color-text-faint)] py-16 italic">{t('no_users')}</p>}
        <ul className="space-y-2 pb-2">
          {filtered.map((u) => (
            <li key={u.id}>
              <button onClick={() => handleDemoLogin(u)} disabled={isDemoLoading} className="w-full text-left p-4 border border-[var(--color-border)] hover:border-[var(--color-accent-blue)] hover:bg-[var(--color-bg-elevated)] disabled:opacity-50 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 border border-[var(--color-border-heavy)] flex items-center justify-center text-lg font-bold italic text-[var(--color-text-primary)]">{u.name.charAt(0)}</div>
                  <div>
                    <p className="mono-id text-[var(--color-text-primary)]">{u.name}</p>
                    <p className="mono-label text-[var(--color-text-muted)] mt-0.5">{u.email || 'DEMO_IDENTITY'}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className="badge">{u.isPlatformOperator ? getRoleDisplayName('platform_operator', true) : getRoleDisplayName(u.role as UserRole)}</span>
                  {u.partnerName && <span className="mono-label text-[var(--color-text-secondary)]">{u.partnerName}</span>}
                  <span className="mono-label text-[var(--color-text-muted)]">{(u.lang && LANG_LABEL[u.lang]) || u.lang}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

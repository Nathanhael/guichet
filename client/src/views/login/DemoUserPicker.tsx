import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useT } from '../../i18n';
import { trpc } from '../../utils/trpc';
import { LANG_LABEL } from '../../constants';
import { getRoleDisplayName } from '../../utils/roles';
import Avatar from '../../components/ui/Avatar';
import Pill from '../../components/ui/Pill';
import type { User, Membership, UserRole } from '../../types';

type DemoUser = { id: string; name: string; email?: string; role?: string; lang?: string; isPlatformOperator?: boolean; membershipId?: string | null; partnerId?: string | null; partnerName?: string | null };

interface DemoUserPickerProps {
  onLoginSuccess: (user: User, memberships: Membership[], preferredMembershipId?: string) => void;
}

export default function DemoUserPicker({ onLoginSuccess }: DemoUserPickerProps) {
  const t = useT();
  const [filter, setFilter] = useState<'all' | 'platform' | 'admin' | 'support' | 'agent'>('all');
  const [isDemoLoading, setIsDemoLoading] = useState(false);
  const [error, setError] = useState('');

  const { data: usersData } = trpc.user.demoList.useQuery();
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
      const res = await fetch('/api/v1/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId: u.id }),
      });
      const data = await res.json();
      if (res.ok) {
        const preferredId = u.membershipId ?? undefined;
        onLoginSuccess(data.user, data.memberships || [], preferredId);
      } else {
        setError(data.error || t('login_failed'));
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
      <div className="flex border-b border-[var(--color-border)] px-5 pt-1 bg-[var(--color-bg-surface)] overflow-x-auto no-scrollbar">
        {(['all', 'platform', 'admin', 'support', 'agent'] as const).map((tab) => {
          const active = filter === tab;
          return (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-3 py-2.5 text-[12px] font-medium border-b-2 mr-1 shrink-0 transition-colors ${
                active
                  ? 'border-[var(--color-accent)] text-[var(--color-ink)]'
                  : 'border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              {tab === 'all' ? t('all') : tab === 'platform' ? getRoleDisplayName('platform_operator', true) : getRoleDisplayName(tab as UserRole)}
            </button>
          );
        })}
      </div>
      <div className="p-5 max-h-[28rem] overflow-y-auto bg-[var(--color-bg-surface)]">
        {error && (
          <div className="rounded-[var(--radius-btn)] bg-[var(--color-urgent-soft)] border border-[var(--color-urgent)]/30 px-3 py-2.5 mb-3 flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 text-[var(--color-urgent)] mt-0.5 shrink-0" />
            <p className="text-[13px] text-[var(--color-urgent)]">{error}</p>
          </div>
        )}
        {filtered.length === 0 && (
          <p className="text-center text-[13px] text-[var(--color-ink-muted)] py-14">{t('no_users')}</p>
        )}
        <ul className="space-y-2 pb-1">
          {filtered.map((u) => (
            <li key={u.id}>
              <button
                onClick={() => handleDemoLogin(u)}
                disabled={isDemoLoading}
                className="w-full text-left px-3 py-2.5 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-accent)] hover:bg-[var(--color-hover)] disabled:opacity-50 transition-colors flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={u.name} size={36} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-[var(--color-ink)] truncate">{u.name}</p>
                    <p className="text-[12px] text-[var(--color-ink-muted)] truncate">{u.email || '—'}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Pill tone={u.isPlatformOperator ? 'accent' : 'neutral'}>
                    {u.isPlatformOperator ? getRoleDisplayName('platform_operator', true) : getRoleDisplayName(u.role as UserRole)}
                  </Pill>
                  {u.partnerName && <span className="text-[11px] text-[var(--color-ink-soft)]">{u.partnerName}</span>}
                  <span className="text-[11px] text-[var(--color-ink-muted)]">{(u.lang && LANG_LABEL[u.lang]) || u.lang}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

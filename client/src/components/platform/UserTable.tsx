import { useState, useCallback } from 'react';
import { LogOut, X } from 'lucide-react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import ConfirmDialog from '../ConfirmDialog';
import Toast from '../Toast';
import Button from '../ui/Button';
import Pill from '../ui/Pill';
import type { PartnerMembership, UserRole } from './types';
import { getRoleDisplayName } from '../../utils/roles';

const INPUT =
  'w-full h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';
const TH = 'px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]';

export default function UserTable() {
  const t = useT();
  const [userSearch, setUserSearch] = useState('');
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>('all');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel?: string; onConfirm: () => void } | null>(null);
  const showToast = useCallback((message: string) => setToast({ message, type: 'success' }), []);
  const showError = useCallback((message: string) => setToast({ message, type: 'error' }), []);

  const { data: globalUsersData } = trpc.platform.listGlobalUsers.useQuery();
  const globalUsers = globalUsersData?.users;
  const { data: partners } = trpc.platform.listPartners.useQuery();

  const revokeSessions = trpc.user.revokeSessions.useMutation({
    onSuccess: () => showToast('Sessions revoked'),
    onError: (err) => showError(`Failed to revoke sessions: ${err.message}`),
  });

  const filteredUsers = (globalUsers || []).filter(u => {
    if (u.deletedAt) return false;
    const search = userSearch.toLowerCase();
    const matchesSearch = u.name.toLowerCase().includes(search) || (u.email || '').toLowerCase().includes(search);
    const matchesPartner = selectedPartnerId === 'all' || u.partnerMemberships?.some((m) => m.partnerId === selectedPartnerId);
    return matchesSearch && matchesPartner;
  });

  return (
    <>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex-1">
          <h1 className="text-[22px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">{t('global_users')}</h1>
          <p className="text-[13px] text-[var(--color-ink-muted)] mt-1">{t('manage_identities_desc')}</p>
          <div className="mt-5 flex flex-col sm:flex-row gap-3 max-w-3xl">
            <div className="flex-[2] min-w-0 relative">
              <input
                type="text"
                placeholder={t('search_users_placeholder')}
                className={INPUT}
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
              />
              {userSearch && (
                <button
                  onClick={() => setUserSearch('')}
                  aria-label={t('clear')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex-1 min-w-[200px]">
              <select
                className={INPUT}
                value={selectedPartnerId}
                onChange={(e) => setSelectedPartnerId(e.target.value)}
              >
                <option value="all">{t('all_partners')}</option>
                {partners?.filter(p => !p.deletedAt).map(p => (
                  <option key={p.id} value={p.id}>
                    {p.status === 'inactive' ? `[${t('inactive_status')}] ${p.name}` : p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
                <th className={TH}>{t('col_name')}</th>
                <th className={TH}>{t('email_identity')}</th>
                <th className={TH}>{t('col_status')}</th>
                <th className={TH}>{t('last_active')}</th>
                <th className={TH}>{t('col_access_scope')}</th>
                <th className={`${TH} text-right`}>{t('col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length > 0 ? filteredUsers.map((u) => (
                <tr key={u.id} className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-hover)] transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap align-top">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-[var(--color-ink)]">{u.name}</span>
                      {u.isPlatformOperator && (
                        <Pill tone="accent">ROOT</Pill>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <p className="text-[13px] text-[var(--color-ink)]">{u.email || '\u2014'}</p>
                    <p className="text-[11px] font-mono text-[var(--color-ink-muted)] mt-0.5">{t('id_label')}: {u.id}</p>
                  </td>
                  <td className="px-4 py-3 align-top">
                    {u.externalId ? (
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-ok)]">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-ok)]" />
                        {t('status_linked_sso')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-ink-muted)]">
                        <span className="inline-block w-1.5 h-1.5 rounded-full border border-[var(--color-border-strong)]" />
                        {t('status_pending')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-[12px] text-[var(--color-ink-soft)]">
                    {u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleString() : t('never')}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                      {u.isPlatformOperator && (
                        <Pill tone="accent">
                          {t('all_partners')} <span className="opacity-70 font-normal">({getRoleDisplayName('platform_operator', true)})</span>
                        </Pill>
                      )}
                      {(u.partnerMemberships?.length ?? 0) > 0 ? u.partnerMemberships!.map((m: PartnerMembership) => (
                        <Pill key={m.partnerId} tone="neutral">
                          {m.partnerName} <span className="opacity-60 font-normal">({getRoleDisplayName(m.role as UserRole)})</span>
                        </Pill>
                      )) : !u.isPlatformOperator && (
                        <span className="text-[12px] text-[var(--color-ink-muted)]">{t('no_active_memberships')}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right align-top">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {u.externalId && (
                        <Button
                          variant="danger"
                          size="sm"
                          leading={<LogOut className="h-3.5 w-3.5" aria-hidden />}
                          title={`Force sign-out all active sessions for ${u.name}`}
                          onClick={() => setConfirmDialog({
                            title: 'Revoke Sessions',
                            message: `Force sign-out all active sessions for ${u.name}? They'll have to sign in again via SSO.`,
                            confirmLabel: 'Revoke Sessions',
                            onConfirm: () => { revokeSessions.mutate({ userId: u.id }); setConfirmDialog(null); },
                          })}
                        >
                          Revoke Sessions
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-[13px] text-[var(--color-ink-muted)]">
                    {t('no_users')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}

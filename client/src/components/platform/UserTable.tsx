import { useState, useCallback } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import ConfirmDialog from '../ConfirmDialog';
import Toast from '../Toast';
import type { GlobalUser, PartnerMembership, UserRole } from './types';
import { getRoleDisplayName } from '../../utils/roles';

interface UserTableProps {
  onInviteClick: () => void;
  onEditProfile: (user: GlobalUser) => void;
  onManageAccess: (user: GlobalUser) => void;
}

function isLocked(u: GlobalUser): boolean {
  return !!u.lockedUntil && new Date(u.lockedUntil) > new Date();
}

export default function UserTable({ onInviteClick, onEditProfile, onManageAccess }: UserTableProps) {
  const t = useT();
  const utils = trpc.useUtils();
  const [userSearch, setUserSearch] = useState('');
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>('all');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel?: string; onConfirm: () => void } | null>(null);
  const showToast = useCallback((message: string) => setToast({ message, type: 'success' }), []);
  const showError = useCallback((message: string) => setToast({ message, type: 'error' }), []);

  const { data: globalUsersData } = trpc.platform.listGlobalUsers.useQuery();
  const globalUsers = globalUsersData?.users;
  const { data: partners } = trpc.platform.listPartners.useQuery();

  const deleteUser = trpc.platform.deleteUser.useMutation({
    onSuccess: () => utils.platform.listGlobalUsers.invalidate(),
  });

  const revokeSessions = trpc.user.revokeSessions.useMutation({
    onSuccess: () => showToast('Sessions revoked'),
    onError: (err) => showError(`Failed to revoke sessions: ${err.message}`),
  });

  const resendInvite = trpc.platform.resendInvite.useMutation({
    onSuccess: () => showToast(t('invite_resent_success')),
    onError: (err) => showError(`${t('invite_resent_error')}: ${err.message}`),
  });

  const disableMfa = trpc.platform.disableUserMfa.useMutation({
    onSuccess: () => { utils.platform.listGlobalUsers.invalidate(); showToast('MFA disabled'); },
    onError: (err) => showError(`Failed to disable MFA: ${err.message}`),
  });

  const unlockUser = trpc.platform.unlockUser.useMutation({
    onSuccess: () => { utils.platform.listGlobalUsers.invalidate(); showToast('User unlocked'); },
    onError: (err) => showError(`Failed to unlock user: ${err.message}`),
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
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-8 border-b border-[var(--color-border-heavy)] pb-6">
        <div className="flex-1">
          <h1 className="text-4xl font-bold uppercase tracking-tighter font-mono">{t('global_users')}</h1>
          <p className="text-sm font-bold uppercase text-[var(--color-text-muted)] mt-1 tracking-widest">{t('manage_identities_desc')}</p>
          <div className="mt-6 flex flex-col sm:flex-row gap-4 max-w-2xl relative">
            <div className="flex-1 relative">
              <input type="text" placeholder={t('search_users_placeholder')} className="input-field w-full" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
              {userSearch && <button onClick={() => setUserSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">{t('clear')}</button>}
            </div>
            <select className="input-field px-4 py-2.5 text-sm font-bold uppercase tracking-widest" value={selectedPartnerId} onChange={(e) => setSelectedPartnerId(e.target.value)}>
              <option value="all">{t('all_partners')}</option>
              {partners?.filter(p => !p.deletedAt).map(p => <option key={p.id} value={p.id}>{p.status === 'inactive' ? `[${t('inactive_status')}] ${p.name}` : p.name}</option>)}
            </select>
          </div>
        </div>
        <button onClick={onInviteClick} className="btn-primary px-8 py-3 text-[10px] uppercase tracking-widest shrink-0">{t('invite_new_user')}</button>
      </div>

      <div className="border border-[var(--color-border)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[var(--color-bg-elevated)] text-[10px] font-bold uppercase tracking-widest font-mono">
                <th className="p-4 border-r border-b border-[var(--color-border)] text-[var(--color-text-muted)]">{t('col_name')}</th>
                <th className="p-4 border-r border-b border-[var(--color-border)] text-[var(--color-text-muted)]">{t('email_identity')}</th>
                <th className="p-4 border-r border-b border-[var(--color-border)] text-[var(--color-text-muted)]">{t('col_status')}</th>
                <th className="p-4 border-r border-b border-[var(--color-border)] text-[var(--color-text-muted)]">{t('last_active')}</th>
                <th className="p-4 border-r border-b border-[var(--color-border)] text-[var(--color-text-muted)]">{t('col_access_scope')}</th>
                <th className="p-4 border-b border-[var(--color-border)] text-right text-[var(--color-text-muted)]">{t('col_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {filteredUsers.length > 0 ? filteredUsers.map((u) => (
                <tr key={u.id} className="text-sm font-bold hover:bg-[var(--color-bg-elevated)]">
                  <td className="p-4 uppercase tracking-tighter whitespace-nowrap border-r border-[var(--color-border)]">
                    {u.name}
                    {u.isPlatformOperator && <span className="ml-2 text-[8px] border border-[var(--color-border)] px-1.5 py-0.5 align-middle bg-[var(--color-text-primary)] text-[var(--color-bg-base)] font-mono">ROOT</span>}
                  </td>
                  <td className="p-4 border-r border-[var(--color-border)]">
                    <p className="font-mono text-xs mb-0.5">{u.email || '\u2014'}</p>
                    <p className="mono-id text-[var(--color-text-faint)]">{t('id_label')}: {u.id}</p>
                  </td>
                  <td className="p-4 border-r border-[var(--color-border)]">
                    <div className="flex flex-col gap-1.5">
                      {/* Connection status */}
                      {u.externalId || u.lastActiveAt ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 bg-[var(--color-accent-green)]" />
                          <span className="text-[9px] font-bold uppercase tracking-widest font-mono">{u.externalId ? t('status_linked_sso') : t('status_active_local')}</span>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-1.5 opacity-40">
                            <div className="w-1.5 h-1.5 border border-[var(--color-border)]" />
                            <span className="text-[9px] font-bold uppercase tracking-widest font-mono">{t('status_pending')}</span>
                          </div>
                          <button onClick={() => {
                            const membershipsArr = u.partnerMemberships || [];
                            const resolvedPartnerId: string | undefined = selectedPartnerId !== 'all' ? selectedPartnerId : membershipsArr.length === 1 ? membershipsArr[0].partnerId : undefined;
                            if (!resolvedPartnerId) { showError(t('select_partner_for_resend')); return; }
                            setConfirmDialog({
                              title: t('resend_invite'),
                              message: t('confirm_resend_invite').replace('{email}', u.email || ''),
                              confirmLabel: t('resend_invite'),
                              onConfirm: () => { resendInvite.mutate({ userId: u.id, partnerId: resolvedPartnerId }); setConfirmDialog(null); }
                            });
                          }} className="text-[8px] font-bold uppercase tracking-widest underline underline-offset-2 hover:opacity-60 text-left font-mono">{t('resend_invite')}</button>
                        </div>
                      )}
                      {/* Security badges */}
                      <div className="flex flex-wrap gap-1">
                        {u.mfaEnabledAt && (
                          <span className="badge bg-[var(--color-accent-blue)] text-white">MFA</span>
                        )}
                        {isLocked(u) && (
                          <span className="badge bg-[var(--color-accent-red)] text-white">LOCKED</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-4 border-r border-[var(--color-border)] mono-timestamp text-[var(--color-text-secondary)]">{u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleString() : t('never')}</td>
                  <td className="p-4 border-r border-[var(--color-border)]">
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto custom-scrollbar pr-2">
                      {u.isPlatformOperator && <span className="border border-[var(--color-border)] text-[8px] font-bold uppercase px-2 py-1 flex items-center gap-1 shrink-0 bg-[var(--color-text-primary)] text-[var(--color-bg-base)] font-mono">{t('all_partners')} <span className="opacity-60 italic">({getRoleDisplayName('platform_operator', true)})</span></span>}
                      {(u.partnerMemberships?.length ?? 0) > 0 ? u.partnerMemberships!.map((m: PartnerMembership) => (
                        <span key={m.partnerId} className="border border-[var(--color-border)] text-[8px] font-bold uppercase px-2 py-1 flex items-center gap-1 shrink-0 font-mono">{m.partnerName} <span className="opacity-40 italic">({getRoleDisplayName(m.role as UserRole)})</span></span>
                      )) : !u.isPlatformOperator && <span className="text-[var(--color-text-faint)] text-[10px] uppercase font-bold tracking-widest">{t('no_active_memberships')}</span>}
                    </div>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button onClick={() => onEditProfile(u)} className="btn-secondary text-[10px] uppercase tracking-widest px-3 py-1.5">{t('edit_profile')}</button>
                      <button onClick={() => onManageAccess(u)} className="btn-secondary text-[10px] uppercase tracking-widest px-3 py-1.5 opacity-60 hover:opacity-100">{t('manage_access')}</button>
                      {u.mfaEnabledAt && (
                        <button onClick={() => setConfirmDialog({
                          title: 'Disable MFA',
                          message: `Force-disable two-factor authentication for ${u.name}? They will be able to log in with password only.`,
                          confirmLabel: 'Disable MFA',
                          onConfirm: () => { disableMfa.mutate(u.id); setConfirmDialog(null); }
                        })} className="btn-secondary text-[10px] uppercase tracking-widest px-3 py-1.5 opacity-60 hover:opacity-100">
                          Disable MFA
                        </button>
                      )}
                      {isLocked(u) && (
                        <button onClick={() => setConfirmDialog({
                          title: 'Unlock User',
                          message: `Unlock ${u.name}'s account immediately? This clears the lockout and resets failed login attempts.`,
                          confirmLabel: 'Unlock',
                          onConfirm: () => { unlockUser.mutate(u.id); setConfirmDialog(null); }
                        })} className="btn-secondary text-[10px] uppercase tracking-widest px-3 py-1.5 opacity-60 hover:opacity-100">
                          Unlock
                        </button>
                      )}
                      <button onClick={() => setConfirmDialog({
                        title: 'Revoke Sessions',
                        message: `Force sign-out all active sessions for ${u.name}?`,
                        confirmLabel: 'Revoke Sessions',
                        onConfirm: () => { revokeSessions.mutate({ userId: u.id }); setConfirmDialog(null); }
                      })} className="btn-secondary text-[10px] uppercase tracking-widest px-3 py-1.5 opacity-60 hover:opacity-100">
                        Revoke Sessions
                      </button>
                      <button onClick={() => setConfirmDialog({
                        title: t('delete_account'),
                        message: t('confirm_delete_account').replace('{name}', u.name),
                        confirmLabel: t('delete_account'),
                        onConfirm: () => { deleteUser.mutate(u.id); setConfirmDialog(null); }
                      })} className="btn-danger text-[10px] uppercase tracking-widest px-3 py-1.5 opacity-40 hover:opacity-100">{t('delete_account')}</button>
                    </div>
                  </td>
                </tr>
              )) : <tr><td colSpan={6} className="p-12 text-center"><p className="text-xl font-bold uppercase text-[var(--color-text-faint)] tracking-widest font-mono">{t('no_users')}</p></td></tr>}
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

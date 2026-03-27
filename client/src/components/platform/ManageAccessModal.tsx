import { useState, useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import ConfirmDialog from '../ConfirmDialog';
import type { GlobalUser, PartnerMembership, UserRole } from './types';
import { getRoleDisplayName } from '../../utils/roles';

interface ManageAccessModalProps {
  user: GlobalUser | null;
  onClose: () => void;
}

export default function ManageAccessModal({ user, onClose }: ManageAccessModalProps) {
  const t = useT();
  const utils = trpc.useUtils();
  const [localUser, setLocalUser] = useState<GlobalUser | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel?: string; onConfirm: () => void } | null>(null);

  useEffect(() => {
    if (user) setLocalUser(user);
  }, [user]);

  async function refreshUser() {
    const freshData = await utils.platform.listGlobalUsers.fetch();
    if (localUser && freshData) {
      const updatedUser = freshData.find(u => u.id === localUser.id);
      if (updatedUser) setLocalUser(updatedUser);
      else onClose();
    }
  }

  const removeMembership = trpc.platform.removeMembership.useMutation({
    onSuccess: async () => {
      utils.platform.listGlobalUsers.invalidate();
      await refreshUser();
    }
  });

  const updateMembership = trpc.platform.updateMembership.useMutation({
    onSuccess: async () => {
      utils.platform.listGlobalUsers.invalidate();
      await refreshUser();
    }
  });

  if (!user || !localUser) return null;

  return (
    <>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
        <div onClick={onClose} aria-label="Close" className="absolute inset-0 bg-black/80" />
        <div role="dialog" className="w-full max-w-2xl bg-[var(--color-bg-surface)] border border-[var(--color-border)] relative z-10 p-8 max-h-[90vh] overflow-y-auto custom-scrollbar">
          <div className="flex justify-between items-start mb-6 border-b border-[var(--color-border)] pb-4">
            <div>
              <h2 className="text-2xl font-bold uppercase tracking-wide font-mono">{t('manage_access')}</h2>
              <p className="text-sm font-bold uppercase text-[var(--color-text-muted)] tracking-widest">{localUser.name}</p>
            </div>
            <button onClick={onClose} aria-label="Close" className="text-xl font-bold text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">&#10005;</button>
          </div>
          <div className="space-y-8">
            {(localUser.partnerMemberships?.length ?? 0) > 0 ? localUser.partnerMemberships!.map((m: PartnerMembership) => (
              <div key={m.id} className="border border-[var(--color-border)] p-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="section-header">{m.partnerName}</h3>
                  <button onClick={() => setConfirmDialog({
                    title: t('revoke_access'),
                    message: t('confirm_revoke_access').replace('{name}', localUser.name),
                    confirmLabel: t('revoke_access'),
                    onConfirm: () => { removeMembership.mutate(m.id); setConfirmDialog(null); }
                  })} className="btn-danger text-[8px] uppercase tracking-widest px-2 py-1">{t('revoke_access')}</button>
                </div>
                <select className="input-field w-full text-xs" value={m.role} onChange={(e) => updateMembership.mutate({ id: m.id, data: { role: e.target.value as UserRole } })}>
                  <option value="agent">{getRoleDisplayName('agent')}</option>
                  <option value="support">{getRoleDisplayName('support')}</option>
                  <option value="admin">{getRoleDisplayName('admin')}</option>
                  <option value="platform_operator">{getRoleDisplayName('platform_operator', true)}</option>
                </select>
              </div>
            )) : (
              <div className="p-12 text-center border border-dashed border-[var(--color-border)]">
                <p className="text-sm font-bold uppercase text-[var(--color-text-faint)] tracking-widest">{t('no_active_memberships')}</p>
              </div>
            )}
          </div>
          <div className="flex justify-end mt-10">
            <button onClick={onClose} className="btn-primary px-8 py-3 uppercase text-[10px] tracking-widest">{t('done')}</button>
          </div>
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
    </>
  );
}

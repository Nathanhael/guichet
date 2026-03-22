import { useState, useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import ConfirmDialog from '../ConfirmDialog';
import type { GlobalUser, PartnerMembership, UserRole } from './types';

interface ManageAccessModalProps {
  user: GlobalUser | null;
  onClose: () => void;
}

export default function ManageAccessModal({ user, onClose }: ManageAccessModalProps) {
  const t = useT();
  const utils = trpc.useUtils();
  const [localUser, setLocalUser] = useState<GlobalUser | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel?: string; onConfirm: () => void } | null>(null);

  const ROLE_LABEL: Record<string, string> = {
    agent: t('agent'),
    support: t('support'),
    admin: t('admin'),
    platform_operator: t('platform_operator')
  };

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
        <div onClick={onClose} className="absolute inset-0 bg-black opacity-80" />
        <div className="w-full max-w-2xl bg-white dark:bg-black border-4 border-black dark:border-white relative z-10 p-8 max-h-[90vh] overflow-y-auto custom-scrollbar">
          <div className="flex justify-between items-start mb-6 border-b-2 border-black dark:border-white pb-4">
            <div>
              <h2 className="text-2xl font-black uppercase tracking-tighter">{t('manage_access')}</h2>
              <p className="text-sm font-bold uppercase opacity-60 tracking-widest">{localUser.name}</p>
            </div>
            <button onClick={onClose} className="text-xl font-black">{'\u2715'}</button>
          </div>
          <div className="space-y-8">
            {(localUser.partnerMemberships?.length ?? 0) > 0 ? localUser.partnerMemberships!.map((m: PartnerMembership) => (
              <div key={m.id} className="border-2 border-black dark:border-white p-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-black uppercase tracking-widest text-xs">{m.partnerName}</h3>
                  <button onClick={() => setConfirmDialog({
                    title: t('revoke_access'),
                    message: t('confirm_revoke_access').replace('{name}', localUser.name),
                    confirmLabel: t('revoke_access'),
                    onConfirm: () => { removeMembership.mutate(m.id); setConfirmDialog(null); }
                  })} className="text-[8px] font-black uppercase tracking-widest border border-black dark:border-white px-2 py-1 hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black">{t('revoke_access')}</button>
                </div>
                <select className="w-full bg-black/5 dark:bg-white/5 border border-black dark:border-white px-2 py-1.5 text-xs font-bold outline-none" value={m.role} onChange={(e) => updateMembership.mutate({ id: m.id, data: { role: e.target.value as UserRole } })}>
                  <option value="agent">{ROLE_LABEL.agent}</option>
                  <option value="support">{ROLE_LABEL.support}</option>
                  <option value="admin">{ROLE_LABEL.admin}</option>
                  <option value="platform_operator">{ROLE_LABEL.platform_operator}</option>
                </select>
              </div>
            )) : (
              <div className="p-12 text-center border-2 border-dashed border-black/20 dark:border-white/20">
                <p className="text-sm font-black uppercase opacity-20 tracking-widest">{t('no_active_memberships')}</p>
              </div>
            )}
          </div>
          <div className="flex justify-end mt-10">
            <button onClick={onClose} className="px-8 py-3 bg-black dark:bg-white text-white dark:text-black font-black uppercase text-[10px] tracking-widest border-2 border-black dark:border-white hover:invert">{t('done')}</button>
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

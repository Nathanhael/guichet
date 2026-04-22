import { useState, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import ConfirmDialog from '../ConfirmDialog';
import Modal, { ModalHeader, ModalBody, ModalFooter } from '../ui/Modal';
import Button from '../ui/Button';
import type { GlobalUser, PartnerMembership, UserRole } from './types';
import { getRoleDisplayName } from '../../utils/roles';

interface ManageAccessModalProps {
  user: GlobalUser | null;
  onClose: () => void;
}

const INPUT =
  'w-full h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';

export default function ManageAccessModal({ user, onClose }: ManageAccessModalProps) {
  const t = useT();
  const utils = trpc.useUtils();
  const [localUser, setLocalUser] = useState<GlobalUser | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel?: string; onConfirm: () => void } | null>(null);

  // Hydrate local copy when the modal opens onto a user (prop→state sync).
  // Kept as local state so refreshUser() can mutate it after access changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) setLocalUser(user);
  }, [user]);

  async function refreshUser() {
    const freshData = await utils.platform.listGlobalUsers.fetch();
    if (localUser && freshData) {
      const updatedUser = freshData.users.find(u => u.id === localUser.id);
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
      <Modal open={!!user} onClose={onClose} id="manage-access" maxWidth={640}>
        <ModalHeader onClose={onClose} title={t('manage_access')} subtitle={localUser.name} />
        <ModalBody className="max-h-[70vh] overflow-y-auto">
          <div className="space-y-3">
            {(localUser.partnerMemberships?.length ?? 0) > 0 ? localUser.partnerMemberships!.map((m: PartnerMembership) => (
              <div
                key={m.id}
                className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4"
              >
                <div className="flex justify-between items-center mb-3 gap-3">
                  <h3 className="text-[14px] font-medium text-[var(--color-ink)] truncate" title={m.partnerName}>{m.partnerName}</h3>
                  <Button
                    variant="danger"
                    size="sm"
                    leading={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => setConfirmDialog({
                      title: t('revoke_access'),
                      message: t('confirm_revoke_access').replace('{name}', localUser.name),
                      confirmLabel: t('revoke_access'),
                      onConfirm: () => { removeMembership.mutate(m.id); setConfirmDialog(null); },
                    })}
                  >
                    {t('revoke_access')}
                  </Button>
                </div>
                <select
                  className={INPUT}
                  value={m.role}
                  onChange={(e) => updateMembership.mutate({ id: m.id, data: { role: e.target.value as UserRole } })}
                >
                  <option value="agent">{getRoleDisplayName('agent')}</option>
                  <option value="support">{getRoleDisplayName('support')}</option>
                  <option value="admin">{getRoleDisplayName('admin')}</option>
                  <option value="platform_operator">{getRoleDisplayName('platform_operator', true)}</option>
                </select>
              </div>
            )) : (
              <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-strong)] p-10 text-center">
                <p className="text-[13px] text-[var(--color-ink-muted)]">{t('no_active_memberships')}</p>
              </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" size="md" onClick={onClose}>{t('done')}</Button>
        </ModalFooter>
      </Modal>

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

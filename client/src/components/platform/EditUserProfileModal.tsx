import { useState, useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import Modal, { ModalHeader, ModalBody, ModalFooter } from '../ui/Modal';
import Button from '../ui/Button';
import type { GlobalUser } from './types';

interface EditUserProfileModalProps {
  user: GlobalUser | null;
  onClose: () => void;
}

const FIELD_LABEL = 'block text-[12px] font-medium text-[var(--color-ink-soft)] mb-1.5';
const INPUT =
  'w-full h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';

export default function EditUserProfileModal({ user, onClose }: EditUserProfileModalProps) {
  const t = useT();
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ name: '', email: '' });

  useEffect(() => {
    if (user) {
      setForm({ name: user.name, email: user.email ?? '' });
    }
  }, [user]);

  const updateUser = trpc.platform.updateUser.useMutation({
    onSuccess: () => {
      utils.platform.listGlobalUsers.invalidate();
      onClose();
    },
  });

  if (!user) return null;

  return (
    <Modal open={!!user} onClose={onClose} id="edit-user-profile" maxWidth={440}>
      <ModalHeader onClose={onClose} title={t('edit_profile')} subtitle={user.name} />
      <ModalBody>
        <div className="space-y-4">
          <div>
            <label className={FIELD_LABEL}>{t('col_name')}</label>
            <input
              type="text"
              className={INPUT}
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className={FIELD_LABEL}>{t('email_label')}</label>
            <input
              type="email"
              className={INPUT}
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
            />
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" size="md" onClick={onClose}>{t('cancel')}</Button>
        <Button
          variant="primary"
          size="md"
          disabled={updateUser.isPending}
          onClick={() => updateUser.mutate({ id: user.id, data: { name: form.name, email: form.email || undefined } })}
        >
          {t('save_profile')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

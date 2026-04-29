import { useState, useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import FormModal, { FIELD_LABEL, INPUT } from '../ui/FormModal';
import type { GlobalUser } from './types';

interface EditUserProfileModalProps {
  user: GlobalUser | null;
  onClose: () => void;
}

export default function EditUserProfileModal({ user, onClose }: EditUserProfileModalProps) {
  const t = useT();
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ name: '', email: '' });

  // Hydrate the form when the modal opens onto a user (prop→state sync).
  useEffect(() => {
    if (user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({ name: user.name, email: user.email ?? '' });
    }
  }, [user]);

  const updateUser = trpc.platform.updateUser.useMutation();

  if (!user) return null;

  return (
    <FormModal
      open={!!user}
      onClose={onClose}
      title={t('edit_profile')}
      subtitle={user.name}
      mutation={updateUser}
      onSubmit={() => ({ id: user.id, data: { name: form.name, email: form.email || undefined } })}
      submitLabel={t('save_profile')}
      cancelLabel={t('cancel')}
      invalidate={() => utils.platform.listGlobalUsers.invalidate()}
      maxWidth={440}
      id="edit-user-profile"
    >
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
    </FormModal>
  );
}

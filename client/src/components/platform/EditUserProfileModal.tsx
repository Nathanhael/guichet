import { useState, useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import type { GlobalUser } from './types';

interface EditUserProfileModalProps {
  user: GlobalUser | null;
  onClose: () => void;
}

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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div onClick={onClose} aria-label="Close" className="absolute inset-0 bg-black/80" />
      <div role="dialog" aria-modal="true" className="w-full max-w-md bg-[var(--color-bg-surface)] border border-[var(--color-border)] relative z-10 p-8">
        <h2 className="text-2xl font-bold uppercase tracking-wide font-mono mb-6 border-b border-[var(--color-border)] pb-2">{t('edit_profile')}</h2>
        <div className="space-y-4">
          <div>
            <label className="mono-label">{t('col_name')}</label>
            <input type="text" className="input-field w-full" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="mono-label">{t('email_label')}</label>
            <input type="email" className="input-field w-full" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="flex justify-end gap-3 mt-8">
            <button onClick={onClose} className="btn-secondary px-6 py-2 text-[10px] uppercase tracking-widest">{t('cancel')}</button>
            <button onClick={() => updateUser.mutate({ id: user.id, data: { name: form.name, email: form.email || undefined } })} disabled={updateUser.isPending} className="btn-primary px-6 py-2 text-[10px] uppercase tracking-widest disabled:opacity-20">{t('save_profile')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

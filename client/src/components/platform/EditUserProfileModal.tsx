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
      <div onClick={onClose} className="absolute inset-0 bg-black opacity-80" />
      <div className="w-full max-w-md bg-white dark:bg-black border-4 border-black dark:border-white relative z-10 p-8">
        <h2 className="text-2xl font-black uppercase tracking-tighter mb-6 border-b-2 border-black dark:border-white pb-2">{t('edit_profile')}</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-black uppercase mb-1">{t('col_name')}</label>
            <input type="text" className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase mb-1">{t('email_label')}</label>
            <input type="email" className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="flex justify-end gap-3 mt-8">
            <button onClick={onClose} className="px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white">{t('cancel')}</button>
            <button onClick={() => updateUser.mutate({ id: user.id, data: { name: form.name, email: form.email || undefined } })} disabled={updateUser.isPending} className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white hover:invert">{t('save_profile')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

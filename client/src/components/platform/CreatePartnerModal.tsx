import { useState, useCallback } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { uploadLogo } from '../../utils/uploadLogo';
import Toast from '../Toast';

interface CreatePartnerModalProps {
  open: boolean;
  onClose: () => void;
}

export default function CreatePartnerModal({ open, onClose }: CreatePartnerModalProps) {
  const t = useT();
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ id: '', name: '', logoUrl: '', industry: '', authMethod: 'local' as 'local' | 'sso' | 'both' });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showError = useCallback((message: string) => setToast({ message, type: 'error' }), []);

  const createPartner = trpc.platform.createPartner.useMutation({
    onSuccess: () => {
      utils.platform.listPartners.invalidate();
      setForm({ id: '', name: '', logoUrl: '', industry: '', authMethod: 'local' as 'local' | 'sso' | 'both' });
      onClose();
    },
    onError: (err) => showError(err.message),
  });

  async function handleLogo(file: File) {
    try {
      const url = await uploadLogo(file);
      setForm(prev => ({ ...prev, logoUrl: url }));
    } catch (err) {
      showError(err instanceof Error ? err.message : t('request_failed'));
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div onClick={onClose} aria-label="Close" className="absolute inset-0 bg-black opacity-80" />
      <div role="dialog" className="w-full max-w-xl bg-white dark:bg-black border-4 border-black dark:border-white relative z-10 p-8">
        <h2 className="text-2xl font-black uppercase tracking-tighter mb-6 border-b-2 border-black dark:border-white pb-2">{t('create_new_partner')}</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase mb-1">{t('partner_id')}</label>
              <input
                type="text"
                placeholder={t('placeholder_partner_id')}
                className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold font-mono outline-none"
                value={form.id}
                onChange={e => setForm({ ...form, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase mb-1">{t('display_name')}</label>
              <input
                type="text"
                placeholder={t('placeholder_partner_name')}
                className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-[10px] font-black uppercase mb-1">Logo</label>
              <div className="flex items-center gap-3">
                {form.logoUrl ? (
                  <img src={form.logoUrl} alt="Partner logo preview" className="w-10 h-10 object-contain border-2 border-black dark:border-white" />
                ) : (
                  <div className="w-10 h-10 border-2 border-dashed border-black/20 dark:border-white/20" />
                )}
                <input type="file" accept="image/*" className="hidden" id="logo-upload-create"
                  onChange={e => e.target.files?.[0] && handleLogo(e.target.files[0])}
                />
                <label htmlFor="logo-upload-create"
                  className="cursor-pointer px-3 py-2 border-2 border-black dark:border-white text-[10px] font-black uppercase hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black"
                >
                  {form.logoUrl ? t('configure') : 'Upload'}
                </label>
              </div>
            </div>
            <div className="flex-1">
              <label className="block text-[10px] font-black uppercase mb-1">{t('provider_label')}</label>
              <select className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none"
                value={form.authMethod} onChange={e => setForm({ ...form, authMethod: e.target.value as 'local' | 'sso' | 'both' })}>
                <option value="local">Local (Email/Password)</option>
                <option value="sso">Enterprise SSO</option>
                <option value="both">Both (Local + SSO)</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t-2 border-black/10 dark:border-white/10">
            <button onClick={onClose}
              className="px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white"
            >{t('cancel')}</button>
            <button onClick={() => createPartner.mutate(form)}
              disabled={!form.id || !form.name || createPartner.isPending}
              className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white disabled:opacity-20"
            >{t('create_new_partner')}</button>
          </div>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

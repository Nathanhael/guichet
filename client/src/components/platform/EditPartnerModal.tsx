import { useState, useEffect, useCallback } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { uploadLogo } from '../../utils/uploadLogo';
import Toast from '../Toast';
import type { Partner } from './types';

interface EditPartnerModalProps {
  partner: Partner | null;
  onClose: () => void;
}

export default function EditPartnerModal({ partner, onClose }: EditPartnerModalProps) {
  const t = useT();
  const utils = trpc.useUtils();
  const [form, setForm] = useState<{ name: string; logoUrl: string | null; authMethod: 'local' | 'sso' }>({ name: '', logoUrl: null, authMethod: 'local' });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showError = useCallback((message: string) => setToast({ message, type: 'error' }), []);

  useEffect(() => {
    if (partner) {
      setForm({ name: partner.name, logoUrl: partner.logoUrl, authMethod: partner.authMethod });
    }
  }, [partner]);

  const updatePartner = trpc.platform.updatePartner.useMutation({
    onSuccess: () => {
      utils.platform.listPartners.invalidate();
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

  if (!partner) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div onClick={onClose} className="absolute inset-0 bg-black opacity-80" />
      <div className="w-full max-w-2xl bg-white dark:bg-black border-4 border-black dark:border-white relative z-10 p-8">
        <h2 className="text-2xl font-black uppercase tracking-tighter mb-6 border-b-2 border-black dark:border-white pb-2">{form.name || partner.name}</h2>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase mb-1">{t('display_name')}</label>
              <input type="text" className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none"
                value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase mb-1">{t('id_label')}</label>
              <div className="w-full bg-black/5 dark:bg-white/5 border-2 border-black/20 dark:border-white/20 px-3 py-2 text-sm font-bold font-mono opacity-50">{partner.id}</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-[10px] font-black uppercase mb-1">Logo</label>
              <div className="flex items-center gap-3">
                {form.logoUrl ? (
                  <img src={form.logoUrl} className="w-10 h-10 object-contain border-2 border-black dark:border-white" />
                ) : (
                  <div className="w-10 h-10 border-2 border-dashed border-black/20 dark:border-white/20" />
                )}
                <input type="file" accept="image/*" className="hidden" id="logo-upload-edit"
                  onChange={e => e.target.files?.[0] && handleLogo(e.target.files[0])}
                />
                <label htmlFor="logo-upload-edit"
                  className="cursor-pointer px-3 py-2 border-2 border-black dark:border-white text-[10px] font-black uppercase hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black"
                >
                  {form.logoUrl ? t('configure') : 'Upload'}
                </label>
              </div>
            </div>
            <div className="flex-1">
              <label className="block text-[10px] font-black uppercase mb-1">{t('provider_label')}</label>
              <select className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none"
                value={form.authMethod} onChange={e => setForm({ ...form, authMethod: e.target.value as 'local' | 'sso' })}>
                <option value="local">Local (Email/Password)</option>
                <option value="sso">Enterprise SSO</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t-2 border-black/10 dark:border-white/10">
            <button onClick={onClose}
              className="px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white"
            >{t('cancel')}</button>
            <button onClick={() => updatePartner.mutate({ id: partner.id, data: { name: form.name, logoUrl: form.logoUrl || undefined, authMethod: form.authMethod } })}
              disabled={updatePartner.isPending}
              className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white disabled:opacity-20"
            >{t('save_profile')}</button>
          </div>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

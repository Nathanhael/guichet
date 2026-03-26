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
      <div onClick={onClose} aria-label="Close" className="absolute inset-0 bg-black/80" />
      <div role="dialog" className="w-full max-w-xl bg-[var(--color-bg-surface)] border border-[var(--color-border)] relative z-10 p-8">
        <h2 className="text-2xl font-bold uppercase tracking-wide font-mono mb-6 border-b border-[var(--color-border)] pb-2">{t('create_new_partner')}</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mono-label">{t('partner_id')}</label>
              <input
                type="text"
                placeholder={t('placeholder_partner_id')}
                className="input-field w-full font-mono"
                value={form.id}
                onChange={e => setForm({ ...form, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
              />
            </div>
            <div>
              <label className="mono-label">{t('display_name')}</label>
              <input
                type="text"
                placeholder={t('placeholder_partner_name')}
                className="input-field w-full"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="mono-label">Logo</label>
              <div className="flex items-center gap-3">
                {form.logoUrl ? (
                  <img src={form.logoUrl} alt="Partner logo preview" className="w-10 h-10 object-contain border border-[var(--color-border)]" />
                ) : (
                  <div className="w-10 h-10 border border-dashed border-[var(--color-border)]" />
                )}
                <input type="file" accept="image/*" className="hidden" id="logo-upload-create"
                  onChange={e => e.target.files?.[0] && handleLogo(e.target.files[0])}
                />
                <label htmlFor="logo-upload-create" className="btn-secondary cursor-pointer px-3 py-2 text-[10px] uppercase">
                  {form.logoUrl ? t('configure') : 'Upload'}
                </label>
              </div>
            </div>
            <div className="flex-1">
              <label className="mono-label">{t('provider_label')}</label>
              <select className="input-field w-full"
                value={form.authMethod} onChange={e => setForm({ ...form, authMethod: e.target.value as 'local' | 'sso' | 'both' })}>
                <option value="local">Local (Email/Password)</option>
                <option value="sso">Enterprise SSO</option>
                <option value="both">Both (Local + SSO)</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
            <button onClick={onClose} className="btn-secondary px-6 py-2 text-[10px] uppercase tracking-widest">{t('cancel')}</button>
            <button onClick={() => createPartner.mutate(form)}
              disabled={!form.id || !form.name || createPartner.isPending}
              className="btn-primary px-6 py-2 text-[10px] uppercase tracking-widest disabled:opacity-20"
            >{t('create_new_partner')}</button>
          </div>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

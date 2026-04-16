import { useState, useCallback } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import Toast from '../Toast';

interface CreatePartnerModalProps {
  open: boolean;
  onClose: () => void;
}

export default function CreatePartnerModal({ open, onClose }: CreatePartnerModalProps) {
  const t = useT();
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ id: '', name: '', industry: '' });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showError = useCallback((message: string) => setToast({ message, type: 'error' }), []);

  const createPartner = trpc.platform.createPartner.useMutation({
    onSuccess: () => {
      utils.platform.listPartners.invalidate();
      setForm({ id: '', name: '', industry: '' });
      onClose();
    },
    onError: (err) => showError(err.message),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div onClick={onClose} aria-label="Close" className="absolute inset-0 bg-black/80" />
      <div role="dialog" aria-modal="true" className="w-full max-w-xl bg-[var(--color-bg-surface)] border border-[var(--color-border)] relative z-10 p-8">
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

import { useState, useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import type { Partner } from './types';

interface DeletePartnerModalProps {
  partner: Partner | null;
  onClose: () => void;
}

export default function DeletePartnerModal({ partner, onClose }: DeletePartnerModalProps) {
  const t = useT();
  const utils = trpc.useUtils();
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    if (partner) setConfirmation('');
  }, [partner]);

  const deletePartner = trpc.platform.deletePartner.useMutation({
    onSuccess: () => {
      utils.platform.listPartners.invalidate();
      onClose();
    },
  });

  if (!partner) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
      <div onClick={onClose} aria-label="Close" className="absolute inset-0 bg-black/80" />
      <div role="dialog" aria-modal="true" className="w-full max-w-md bg-[var(--color-bg-surface)] border border-[var(--color-border)] relative z-10 p-8 text-center">
        <div className="w-16 h-16 border border-[var(--color-border-heavy)] flex items-center justify-center mx-auto mb-6 text-2xl font-bold font-mono text-[var(--color-accent-red)]">!</div>
        <h3 className="text-xl font-bold uppercase tracking-tighter font-mono mb-2">{t('delete_permanently')}</h3>
        <p className="text-sm font-bold uppercase text-[var(--color-text-muted)] mb-6">
          {t('confirm_remove_partner').replace('{name}', partner.name)}
        </p>
        <div className="text-left mb-6">
          <label className="mono-label">{t('display_name')}</label>
          <input
            type="text"
            placeholder={partner.name}
            className="input-field w-full"
            value={confirmation}
            onChange={e => setConfirmation(e.target.value)}
          />
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1 py-3 uppercase text-[10px] tracking-widest">{t('cancel')}</button>
          <button onClick={() => deletePartner.mutate(partner.id)}
            disabled={confirmation !== partner.name || deletePartner.isPending}
            className="btn-danger flex-1 py-3 uppercase text-[10px] tracking-widest disabled:opacity-30"
          >{t('delete_permanently')}</button>
        </div>
      </div>
    </div>
  );
}

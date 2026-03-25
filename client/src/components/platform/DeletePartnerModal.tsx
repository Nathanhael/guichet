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
      <div onClick={onClose} aria-label="Close" className="absolute inset-0 bg-black opacity-80" />
      <div role="dialog" className="w-full max-w-md bg-white dark:bg-black border-4 border-black dark:border-white relative z-10 p-8 text-center">
        <div className="w-16 h-16 border-4 border-black dark:border-white flex items-center justify-center mx-auto mb-6 text-2xl font-black">!</div>
        <h3 className="text-xl font-black uppercase tracking-tighter mb-2">{t('delete_permanently')}</h3>
        <p className="text-sm font-bold uppercase opacity-60 mb-6">
          {t('confirm_remove_partner').replace('{name}', partner.name)}
        </p>
        <div className="text-left mb-6">
          <label className="block text-[10px] font-black uppercase tracking-widest mb-1">{t('display_name')}</label>
          <input
            type="text"
            placeholder={partner.name}
            className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm font-bold outline-none"
            value={confirmation}
            onChange={e => setConfirmation(e.target.value)}
          />
        </div>
        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-3 border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest"
          >{t('cancel')}</button>
          <button onClick={() => deletePartner.mutate(partner.id)}
            disabled={confirmation !== partner.name || deletePartner.isPending}
            className="flex-1 py-3 bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest hover:invert disabled:opacity-30 disabled:hover:invert-0"
          >{t('delete_permanently')}</button>
        </div>
      </div>
    </div>
  );
}

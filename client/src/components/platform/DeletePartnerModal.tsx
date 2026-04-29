import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import FormModal from '../ui/FormModal';
import type { Partner } from './types';

interface DeletePartnerModalProps {
  partner: Partner | null;
  onClose: () => void;
}

export default function DeletePartnerModal({ partner, onClose }: DeletePartnerModalProps) {
  const t = useT();
  const utils = trpc.useUtils();
  const [confirmation, setConfirmation] = useState('');

  // Clear the typed-to-confirm input when the modal opens onto a new partner.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (partner) setConfirmation('');
  }, [partner]);

  const deletePartner = trpc.platform.deletePartner.useMutation();

  if (!partner) return null;

  const headerSlot = (
    <div className="flex items-center gap-3">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-urgent-soft)] text-[var(--color-urgent)]">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div>
        <h2 className="text-[17px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">{t('delete_permanently')}</h2>
        <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
          {t('confirm_remove_partner').replace('{name}', partner.name)}
        </p>
      </div>
    </div>
  );

  return (
    <FormModal
      open={!!partner}
      onClose={onClose}
      headerSlot={headerSlot}
      mutation={deletePartner}
      onSubmit={() => (confirmation === partner.name ? partner.id : null)}
      submitLabel={t('delete_permanently')}
      submitVariant="danger"
      cancelLabel={t('cancel')}
      invalidate={() => utils.platform.listPartners.invalidate()}
      disabled={confirmation !== partner.name}
      maxWidth={440}
      dismissOnBackdrop={false}
      id="delete-partner"
    >
      <FormModal.TypedConfirm
        matchValue={partner.name}
        label={t('display_name')}
        onChange={setConfirmation}
      />
    </FormModal>
  );
}

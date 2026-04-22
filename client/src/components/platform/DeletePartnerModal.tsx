import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import Modal, { ModalHeader, ModalBody, ModalFooter } from '../ui/Modal';
import Button from '../ui/Button';
import type { Partner } from './types';

interface DeletePartnerModalProps {
  partner: Partner | null;
  onClose: () => void;
}

const FIELD_LABEL = 'block text-[12px] font-medium text-[var(--color-ink-soft)] mb-1.5';
const INPUT =
  'w-full h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';

export default function DeletePartnerModal({ partner, onClose }: DeletePartnerModalProps) {
  const t = useT();
  const utils = trpc.useUtils();
  const [confirmation, setConfirmation] = useState('');

  // Clear the typed-to-confirm input when the modal opens onto a new partner.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    <Modal open={!!partner} onClose={onClose} id="delete-partner" maxWidth={440} dismissOnBackdrop={false}>
      <ModalHeader onClose={onClose}>
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
      </ModalHeader>
      <ModalBody>
        <label className={FIELD_LABEL}>{t('display_name')}</label>
        <input
          type="text"
          placeholder={partner.name}
          className={INPUT}
          value={confirmation}
          onChange={e => setConfirmation(e.target.value)}
          autoFocus
        />
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" size="md" onClick={onClose}>{t('cancel')}</Button>
        <Button
          variant="danger"
          size="md"
          disabled={confirmation !== partner.name || deletePartner.isPending}
          onClick={() => deletePartner.mutate(partner.id)}
        >
          {t('delete_permanently')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

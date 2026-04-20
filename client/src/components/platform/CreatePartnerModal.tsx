import { useState, useCallback } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import Toast from '../Toast';
import Modal, { ModalHeader, ModalBody, ModalFooter } from '../ui/Modal';
import Button from '../ui/Button';

interface CreatePartnerModalProps {
  open: boolean;
  onClose: () => void;
}

const FIELD_LABEL = 'block text-[12px] font-medium text-[var(--color-ink-soft)] mb-1.5';
const INPUT =
  'w-full h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';

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

  return (
    <>
      <Modal open={open} onClose={onClose} id="create-partner" maxWidth={560}>
        <ModalHeader onClose={onClose} title={t('create_new_partner')} />
        <ModalBody>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={FIELD_LABEL}>{t('partner_id')}</label>
              <input
                type="text"
                placeholder={t('placeholder_partner_id')}
                className={`${INPUT} font-mono`}
                value={form.id}
                onChange={e => setForm({ ...form, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
              />
            </div>
            <div>
              <label className={FIELD_LABEL}>{t('display_name')}</label>
              <input
                type="text"
                placeholder={t('placeholder_partner_name')}
                className={INPUT}
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" size="md" onClick={onClose}>{t('cancel')}</Button>
          <Button
            variant="primary"
            size="md"
            disabled={!form.id || !form.name || createPartner.isPending}
            onClick={() => createPartner.mutate(form)}
          >
            {t('create_new_partner')}
          </Button>
        </ModalFooter>
      </Modal>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}

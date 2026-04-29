import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import FormModal, { FIELD_LABEL, INPUT } from '../ui/FormModal';

interface CreatePartnerModalProps {
  open: boolean;
  onClose: () => void;
}

export default function CreatePartnerModal({ open, onClose }: CreatePartnerModalProps) {
  const t = useT();
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ id: '', name: '', industry: '' });

  const createPartner = trpc.platform.createPartner.useMutation();

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={t('create_new_partner')}
      mutation={createPartner}
      onSubmit={() => (form.id && form.name ? form : null)}
      submitLabel={t('create_new_partner')}
      cancelLabel={t('cancel')}
      invalidate={() => {
        utils.platform.listPartners.invalidate();
        setForm({ id: '', name: '', industry: '' });
      }}
      disabled={!form.id || !form.name}
      maxWidth={560}
      id="create-partner"
    >
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
    </FormModal>
  );
}

import { useState, useEffect } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import Modal, { ModalHeader, ModalBody, ModalFooter } from '../ui/Modal';
import Button from '../ui/Button';
import FormModal, { FIELD_LABEL, INPUT } from '../ui/FormModal';
import type { UserRole } from './types';
import { getRoleDisplayName } from '../../utils/roles';

interface InviteUserModalProps {
  open: boolean;
  onClose: () => void;
}

export default function InviteUserModal({ open, onClose }: InviteUserModalProps) {
  const t = useT();
  const utils = trpc.useUtils();

  const [form, setForm] = useState<{ email: string; name: string; role: UserRole; partnerId: string; dept: string }>({
    email: '', name: '', role: 'support', partnerId: '', dept: ''
  });
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ isExistingUser: boolean; partnerName: string } | null>(null);

  const { data: partners } = trpc.platform.listPartners.useQuery();

  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const inviteUser = trpc.platform.inviteUser.useMutation();

  // Translate the mutation's per-error-type message into a localized
  // inline error displayed below the form. FormModal also surfaces the
  // raw message via Toast; both UIs are intentional belt-and-suspenders.
  useEffect(() => {
    if (!inviteUser.error) { setError(''); return; }
    const msg = inviteUser.error.message;
    if (msg.includes('email') || msg.includes('Email') || msg.includes('invalid_string')) {
      setError(t('invalid_email_error'));
    } else if (msg.includes('CONFLICT') || msg.includes('already')) {
      setError(t('email_already_exists_error'));
    } else {
      setError(msg || t('general_error'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react only to error.message edge
  }, [inviteUser.error?.message]);

  // Post-success result screen. Stays bespoke (separate Modal) per RFC #64
  // — multi-step wizard pattern doesn't fit FormModal's single-mutation shape.
  if (result) {
    return (
      <Modal open={true} onClose={() => setResult(null)} id="invite-result" maxWidth={440}>
        <ModalHeader onClose={() => setResult(null)}>
          <div className="flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-ok-soft)] text-[var(--color-ok)]">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[17px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">
                {t('invite_resent_success')}
              </h2>
              <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">{result.partnerName}</p>
            </div>
          </div>
        </ModalHeader>
        <ModalBody>
          <p className="text-[13px] text-[var(--color-ink-soft)]">
            {result.isExistingUser ? t('status_linked_sso') : t('sso_enterprise')}
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" size="md" onClick={() => setResult(null)}>{t('done')}</Button>
        </ModalFooter>
      </Modal>
    );
  }

  return (
    <FormModal<
      { email: string; name: string; role: UserRole; partnerId: string; departments?: string[] },
      { isExistingUser: boolean }
    >
      open={open}
      onClose={() => { onClose(); setError(''); }}
      title={t('invite_new_user')}
      mutation={inviteUser}
      onSubmit={() => {
        if (!form.email || !isValidEmail(form.email) || !form.name) return null;
        if (!form.partnerId && form.role !== 'platform_operator') return null;
        return {
          email: form.email, name: form.name, role: form.role, partnerId: form.partnerId,
          departments: form.dept ? [form.dept] : undefined,
        };
      }}
      submitLabel={t('invite_new_user')}
      cancelLabel={t('cancel')}
      onSuccessData={(data) => {
        const currentPartners = utils.platform.listPartners.getData();
        const partnerName = currentPartners?.find(p => p.id === form.partnerId)?.name || form.partnerId;
        setResult({ isExistingUser: data.isExistingUser, partnerName });
        setForm({ email: '', name: '', role: 'support', partnerId: '', dept: '' });
      }}
      invalidate={() => utils.platform.listGlobalUsers.invalidate()}
      disabled={!form.email || !isValidEmail(form.email) || !form.name || (!form.partnerId && form.role !== 'platform_operator')}
      maxWidth={560}
      id="invite-user"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={FIELD_LABEL}>{t('col_name')}</label>
            <input
              type="text"
              className={INPUT}
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className={FIELD_LABEL}>{t('email_label')}</label>
            <input
              type="email"
              className={INPUT}
              value={form.email}
              onChange={e => { setForm({ ...form, email: e.target.value }); setError(''); }}
            />
            {form.email && !isValidEmail(form.email) && (
              <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">{t('placeholder_email')}</p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={FIELD_LABEL}>{t('assign_partner')}</label>
            <select
              className={INPUT}
              value={form.partnerId}
              onChange={e => setForm({ ...form, partnerId: e.target.value })}
            >
              <option value="">—</option>
              {partners?.filter(p => p.status === 'active').map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={FIELD_LABEL}>{t('col_role')}</label>
            <select
              className={INPUT}
              value={form.role}
              onChange={e => setForm({ ...form, role: e.target.value as UserRole })}
            >
              <option value="agent">{getRoleDisplayName('agent')}</option>
              <option value="support">{getRoleDisplayName('support')}</option>
              <option value="admin">{getRoleDisplayName('admin')}</option>
              <option value="platform_operator">{getRoleDisplayName('platform_operator', true)}</option>
            </select>
          </div>
        </div>
        {error && <p className="text-[12px] text-[var(--color-urgent)]">{error}</p>}
      </div>
    </FormModal>
  );
}

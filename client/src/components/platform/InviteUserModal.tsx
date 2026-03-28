import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import type { UserRole } from './types';
import { getRoleDisplayName } from '../../utils/roles';

interface InviteUserModalProps {
  open: boolean;
  onClose: () => void;
}

export default function InviteUserModal({ open, onClose }: InviteUserModalProps) {
  const t = useT();
  const utils = trpc.useUtils();

  const [form, setForm] = useState<{ email: string; name: string; role: UserRole; partnerId: string; dept: string; authMethod: 'local' | 'sso' }>({
    email: '', name: '', role: 'support', partnerId: '', dept: '', authMethod: 'local'
  });
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ tempPassword: string | null; isExistingUser: boolean; partnerName: string } | null>(null);

  const { data: partners } = trpc.platform.listPartners.useQuery();

  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const inviteUser = trpc.platform.inviteUser.useMutation({
    onSuccess: (data) => {
      setError('');
      const currentPartners = utils.platform.listPartners.getData();
      const partnerName = currentPartners?.find(p => p.id === form.partnerId)?.name || form.partnerId;
      setResult({ tempPassword: data.tempPassword, isExistingUser: data.isExistingUser, partnerName });
      setForm({ email: '', name: '', role: 'support', partnerId: '', dept: '', authMethod: 'local' });
      utils.platform.listGlobalUsers.invalidate();
      onClose();
    },
    onError: (err) => {
      const msg = err.message;
      if (msg.includes('email') || msg.includes('Email') || msg.includes('invalid_string')) {
        setError(t('invalid_email_error'));
      } else if (msg.includes('CONFLICT') || msg.includes('already')) {
        setError(t('email_already_exists_error'));
      } else {
        setError(msg || t('general_error'));
      }
    }
  });

  if (!open && !result) return null;

  // Invite result dialog
  if (result) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
        <div onClick={() => setResult(null)} aria-label="Close" className="absolute inset-0 bg-black/80" />
        <div role="dialog" aria-modal="true" className="w-full max-w-md bg-[var(--color-bg-surface)] border border-[var(--color-border)] relative z-10 p-8">
          <h2 className="text-xl font-bold uppercase tracking-wide font-mono mb-6 border-b border-[var(--color-border)] pb-2">
            {t('invite_resent_success')}
          </h2>
          {result.isExistingUser ? (
            <div className="space-y-4">
              <p className="text-xs font-bold uppercase tracking-widest font-mono">
                {t('manage_access')} — {result.partnerName}
              </p>
              <p className="text-[10px] uppercase text-[var(--color-text-muted)]">
                {t('status_linked_sso')}
              </p>
            </div>
          ) : result.tempPassword ? (
            <div className="space-y-4">
              <p className="text-xs font-bold uppercase tracking-widest font-mono">
                {result.partnerName}
              </p>
              <div className="border border-[var(--color-border)] p-4">
                <p className="mono-label mb-2">{t('password_label')}</p>
                <div className="flex items-center justify-between gap-3">
                  <code className="font-mono text-sm font-bold break-all text-[var(--color-text-primary)]">{result.tempPassword}</code>
                  <button onClick={() => navigator.clipboard.writeText(result.tempPassword!)}
                    className="btn-secondary px-3 py-1.5 text-[9px] uppercase tracking-widest"
                  >Copy</button>
                </div>
              </div>
              <p className="text-[9px] uppercase font-bold text-[var(--color-text-muted)]">
                {t('config_verify_note')}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs font-bold uppercase tracking-widest font-mono">
                {result.partnerName}
              </p>
              <p className="text-[10px] uppercase text-[var(--color-text-muted)]">
                {t('sso_enterprise')}
              </p>
            </div>
          )}
          <div className="flex justify-end mt-8">
            <button onClick={() => setResult(null)} className="btn-primary px-6 py-2 text-[10px] uppercase tracking-widest">{t('done')}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div onClick={onClose} aria-label="Close" className="absolute inset-0 bg-black/80" />
      <div role="dialog" aria-modal="true" className="w-full max-w-xl bg-[var(--color-bg-surface)] border border-[var(--color-border)] relative z-10 p-8">
        <h2 className="text-2xl font-bold uppercase tracking-wide font-mono mb-6 border-b border-[var(--color-border)] pb-2">{t('invite_new_user')}</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mono-label">{t('col_name')}</label>
              <input type="text" className="input-field w-full"
                value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="mono-label">{t('email_label')}</label>
              <input type="email" className="input-field w-full"
                value={form.email} onChange={e => { setForm({ ...form, email: e.target.value }); setError(''); }}
              />
              {form.email && !isValidEmail(form.email) && (
                <p className="mt-1 text-[9px] font-bold uppercase text-[var(--color-text-muted)]">{t('placeholder_email')}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mono-label">{t('assign_partner')}</label>
              <select className="input-field w-full"
                value={form.partnerId} onChange={e => setForm({ ...form, partnerId: e.target.value })}>
                <option value="">—</option>
                {partners?.filter(p => p.status === 'active').map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mono-label">{t('col_role')}</label>
              <select className="input-field w-full"
                value={form.role} onChange={e => setForm({ ...form, role: e.target.value as UserRole })}>
                <option value="agent">{getRoleDisplayName('agent')}</option>
                <option value="support">{getRoleDisplayName('support')}</option>
                <option value="admin">{getRoleDisplayName('admin')}</option>
                <option value="platform_operator">{getRoleDisplayName('platform_operator', true)}</option>
              </select>
            </div>
          </div>
          {(() => {
            const selectedPartner = partners?.find(p => p.id === form.partnerId);
            if (selectedPartner?.authMethod === 'both') {
              return (
                <div>
                  <label className="mono-label">Auth Method</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="authMethod" value="local" checked={form.authMethod === 'local'}
                        onChange={() => setForm({ ...form, authMethod: 'local' })}
                        className="accent-current w-4 h-4" />
                      <span className="text-xs font-bold uppercase">Local (Email + Password)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="authMethod" value="sso" checked={form.authMethod === 'sso'}
                        onChange={() => setForm({ ...form, authMethod: 'sso' })}
                        className="accent-current w-4 h-4" />
                      <span className="text-xs font-bold uppercase">SSO (Sign in with Microsoft)</span>
                    </label>
                  </div>
                </div>
              );
            }
            return null;
          })()}
          {error && <p className="text-xs font-bold uppercase text-[var(--color-accent-red)]">{error}</p>}
          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
            <button onClick={() => { onClose(); setError(''); }} className="btn-secondary px-6 py-2 text-[10px] uppercase tracking-widest">{t('cancel')}</button>
            <button onClick={() => {
              const selectedPartner = partners?.find(p => p.id === form.partnerId);
              inviteUser.mutate({
                email: form.email, name: form.name, role: form.role, partnerId: form.partnerId,
                departments: form.dept ? [form.dept] : undefined,
                ...(selectedPartner?.authMethod === 'both' ? { authMethod: form.authMethod } : {}),
              });
            }}
              disabled={!form.email || !isValidEmail(form.email) || !form.name || (!form.partnerId && form.role !== 'platform_operator')}
              className="btn-primary px-6 py-2 text-[10px] uppercase tracking-widest disabled:opacity-20"
            >{t('invite_new_user')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

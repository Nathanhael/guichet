import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import type { UserRole } from './types';

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
  const [result, setResult] = useState<{ tempPassword: string | null; isExistingUser: boolean; partnerName: string } | null>(null);

  const { data: partners } = trpc.platform.listPartners.useQuery();

  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const inviteUser = trpc.platform.inviteUser.useMutation({
    onSuccess: (data) => {
      setError('');
      const currentPartners = utils.platform.listPartners.getData();
      const partnerName = currentPartners?.find(p => p.id === form.partnerId)?.name || form.partnerId;
      setResult({ tempPassword: data.tempPassword, isExistingUser: data.isExistingUser, partnerName });
      setForm({ email: '', name: '', role: 'support', partnerId: '', dept: '' });
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
        <div onClick={() => setResult(null)} className="absolute inset-0 bg-black opacity-80" />
        <div className="w-full max-w-md bg-white dark:bg-black border-4 border-black dark:border-white relative z-10 p-8">
          <h2 className="text-xl font-black uppercase tracking-tighter mb-6 border-b-2 border-black dark:border-white pb-2">
            {t('invite_resent_success')}
          </h2>
          {result.isExistingUser ? (
            <div className="space-y-4">
              <p className="text-xs font-bold uppercase tracking-widest">
                {t('manage_access')} — {result.partnerName}
              </p>
              <p className="text-[10px] uppercase opacity-60">
                {t('status_linked_sso')}
              </p>
            </div>
          ) : result.tempPassword ? (
            <div className="space-y-4">
              <p className="text-xs font-bold uppercase tracking-widest">
                {result.partnerName}
              </p>
              <div className="border-2 border-black dark:border-white p-4">
                <p className="text-[10px] font-black uppercase tracking-widest mb-2 opacity-60">{t('password_label')}</p>
                <div className="flex items-center justify-between gap-3">
                  <code className="font-mono text-sm font-bold break-all">{result.tempPassword}</code>
                  <button onClick={() => navigator.clipboard.writeText(result.tempPassword!)}
                    className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black"
                  >Copy</button>
                </div>
              </div>
              <p className="text-[9px] uppercase font-bold opacity-50">
                {t('config_verify_note')}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs font-bold uppercase tracking-widest">
                {result.partnerName}
              </p>
              <p className="text-[10px] uppercase opacity-60">
                {t('sso_enterprise')}
              </p>
            </div>
          )}
          <div className="flex justify-end mt-8">
            <button onClick={() => setResult(null)}
              className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white"
            >{t('done')}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div onClick={onClose} className="absolute inset-0 bg-black opacity-80" />
      <div className="w-full max-w-xl bg-white dark:bg-black border-4 border-black dark:border-white relative z-10 p-8">
        <h2 className="text-2xl font-black uppercase tracking-tighter mb-6 border-b-2 border-black dark:border-white pb-2">{t('invite_new_user')}</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase mb-1">{t('col_name')}</label>
              <input type="text" className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none"
                value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase mb-1">{t('email_label')}</label>
              <input type="email" className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none"
                value={form.email} onChange={e => { setForm({ ...form, email: e.target.value }); setError(''); }}
              />
              {form.email && !isValidEmail(form.email) && (
                <p className="mt-1 text-[9px] font-black uppercase opacity-50">{t('placeholder_email')}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase mb-1">{t('assign_partner')}</label>
              <select className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none"
                value={form.partnerId} onChange={e => setForm({ ...form, partnerId: e.target.value })}>
                <option value="">—</option>
                {partners?.filter(p => p.status === 'active').map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase mb-1">{t('col_role')}</label>
              <select className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none"
                value={form.role} onChange={e => setForm({ ...form, role: e.target.value as UserRole })}>
                <option value="agent">{t('agent')}</option>
                <option value="support">{t('support')}</option>
                <option value="admin">{t('admin')}</option>
                <option value="platform_operator">{t('platform_operator')}</option>
              </select>
            </div>
          </div>
          {error && <p className="text-xs font-bold uppercase">{error}</p>}
          <div className="flex justify-end gap-3 pt-4 border-t-2 border-black/10 dark:border-white/10">
            <button onClick={() => { onClose(); setError(''); }}
              className="px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white"
            >{t('cancel')}</button>
            <button onClick={() => inviteUser.mutate({ email: form.email, name: form.name, role: form.role, partnerId: form.partnerId, departments: form.dept ? [form.dept] : undefined })}
              disabled={!form.email || !isValidEmail(form.email) || !form.name || (!form.partnerId && form.role !== 'platform_operator')}
              className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white disabled:opacity-20"
            >{t('invite_new_user')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

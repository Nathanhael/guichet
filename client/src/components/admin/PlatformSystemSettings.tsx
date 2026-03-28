import { useState, useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import { Mail, ShieldCheck, Save, Send } from 'lucide-react';
import { useT } from '../../i18n';
import Toast from '../Toast';

export default function PlatformSystemSettings() {
  const t = useT();
  const [mailConfig, setMailConfig] = useState<any>({
    provider: 'none',
    fromEmail: '',
    fromName: 'Tessera Support',
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPass: '',
    smtpSecure: true,
    apiKey: '',
  });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const { data: remoteConfig, isLoading } = trpc.platform.getMailConfig.useQuery();
  const updateConfig = trpc.platform.updateMailConfig.useMutation({
    onSuccess: () => setToast({ message: t('config_save_success'), type: 'success' })
  });

  const sendTest = trpc.platform.sendTestEmail.useMutation({
    onSuccess: () => setToast({ message: t('test_email_success'), type: 'success' }),
    onError: (err) => setToast({ message: `${t('test_email_error')}: ${err.message}`, type: 'error' })
  });

  // IM-22: Use functional setState to avoid stale closure over mailConfig
  useEffect(() => {
    if (remoteConfig) {
      setMailConfig((prev: Record<string, unknown>) => ({ ...prev, ...remoteConfig }));
    }
  }, [remoteConfig]);

  const handleSave = () => {
    updateConfig.mutate(mailConfig);
  };

  const handleTestEmail = () => {
    const email = prompt(t('test_email_prompt'));
    if (email) {
      sendTest.mutate({ email });
    }
  };

  if (isLoading) {
    return <div className="space-y-4">
      <div className="h-12 bg-bg-elevated w-full" />
      <div className="h-64 bg-bg-elevated w-full" />
    </div>;
  }

  return (
    <div className="space-y-12">
      <div className="border-b border-[var(--color-border)] pb-4">
        <h1 className="text-2xl font-bold uppercase tracking-tight">{t('system_config_title')}</h1>
        <p className="text-sm font-bold uppercase text-[var(--color-text-secondary)] mt-1 tracking-wide">{t('system_config_desc')}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2 space-y-8">
          {/* Mail Configuration */}
          <section className="surface-card p-8 relative">
            <div className="absolute -top-4 left-6 bg-[var(--color-text-primary)] text-[var(--color-bg-base)] px-3 py-1 text-[10px] font-bold uppercase tracking-wide flex items-center gap-2">
              <Mail size={12} /> {t('email_infra')}
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="mono-label mb-2 block">{t('provider_label')}</label>
                  <select
                    value={mailConfig.provider}
                    onChange={e => setMailConfig({ ...mailConfig, provider: e.target.value })}
                    className="input-field w-full"
                  >
                    <option value="none">{t('provider_none')}</option>
                    <option value="smtp">{t('provider_smtp')}</option>
                    <option value="resend">{t('provider_resend')}</option>
                    <option value="sendgrid">{t('provider_sendgrid')}</option>
                  </select>
                </div>
                <div>
                  <label className="mono-label mb-2 block">{t('sender_name')}</label>
                  <input
                    type="text"
                    value={mailConfig.fromName}
                    onChange={e => setMailConfig({ ...mailConfig, fromName: e.target.value })}
                    placeholder="e.g. Tessera Support"
                    className="input-field w-full"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="mono-label mb-2 block">{t('sender_email')}</label>
                  <input
                    type="email"
                    value={mailConfig.fromEmail}
                    onChange={e => setMailConfig({ ...mailConfig, fromEmail: e.target.value })}
                    placeholder="noreply@tessera.io"
                    className="input-field w-full"
                  />
                </div>
              </div>

              {mailConfig.provider === 'smtp' && (
                <div className="space-y-6 pt-4 border-t border-[var(--color-border)]">
                  <div className="grid grid-cols-3 gap-6">
                    <div className="col-span-2">
                      <label className="mono-label mb-2 block">{t('smtp_host')}</label>
                      <input
                        type="text"
                        value={mailConfig.smtpHost}
                        onChange={e => setMailConfig({ ...mailConfig, smtpHost: e.target.value })}
                        className="input-field w-full"
                      />
                    </div>
                    <div>
                      <label className="mono-label mb-2 block">{t('smtp_port')}</label>
                      <input
                        type="number"
                        value={mailConfig.smtpPort}
                        onChange={e => setMailConfig({ ...mailConfig, smtpPort: parseInt(e.target.value) })}
                        className="input-field w-full"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="mono-label mb-2 block">{t('smtp_user')}</label>
                      <input
                        type="text"
                        value={mailConfig.smtpUser}
                        onChange={e => setMailConfig({ ...mailConfig, smtpUser: e.target.value })}
                        className="input-field w-full"
                      />
                    </div>
                    <div>
                      <label className="mono-label mb-2 block">{t('smtp_pass')}</label>
                      <input
                        type="password"
                        value={mailConfig.smtpPass}
                        onChange={e => setMailConfig({ ...mailConfig, smtpPass: e.target.value })}
                        className="input-field w-full"
                      />
                    </div>
                  </div>
                </div>
              )}

              {(mailConfig.provider === 'resend' || mailConfig.provider === 'sendgrid') && (
                <div className="pt-4 border-t border-[var(--color-border)]">
                  <label className="mono-label mb-2 block">{t('api_key_label')}</label>
                  <input
                    type="password"
                    value={mailConfig.apiKey}
                    onChange={e => setMailConfig({ ...mailConfig, apiKey: e.target.value })}
                    placeholder={mailConfig.provider === 'resend' ? 're_...' : 'SG....'}
                    className="input-field w-full"
                  />
                </div>
              )}

              <div className="pt-8 flex gap-4">
                <button
                  onClick={handleSave}
                  disabled={updateConfig.isPending}
                  className="btn-primary flex-1 disabled:opacity-50"
                >
                  <Save size={14} /> {updateConfig.isPending ? t('saving') : t('save_config')}
                </button>
                <button
                  disabled={mailConfig.provider === 'none'}
                  onClick={handleTestEmail}
                  className="btn-secondary disabled:opacity-20"
                >
                  <Send size={14} /> {t('send_test')}
                </button>
              </div>
            </div>
          </section>

          {/* Identity Security Settings */}
          <section className="surface-card p-8 relative opacity-40 grayscale cursor-not-allowed">
            <div className="absolute -top-4 left-6 bg-[var(--color-text-primary)] text-[var(--color-bg-base)] px-3 py-1 text-[10px] font-bold uppercase tracking-wide flex items-center gap-2">
              <ShieldCheck size={12} /> {t('identity_security')}
            </div>
            <p className="font-mono text-[9px] font-bold uppercase tracking-wide text-center py-8 text-[var(--color-text-muted)]">{t('security_locked_desc')}</p>
          </section>
        </div>

        <div className="space-y-6">
          <div className="surface-card p-6 bg-bg-elevated">
            <h3 className="text-xs font-bold uppercase tracking-wide mb-4 border-b border-[var(--color-border)] pb-2">{t('config_info_title')}</h3>
            <div className="space-y-4 text-[10px] font-bold uppercase tracking-tight leading-relaxed">
              <p>{t('config_info_text')}</p>
              <p className="text-[var(--color-text-muted)] italic">{t('config_verify_note')}</p>
            </div>
          </div>

          <div className="surface-card p-6 bg-bg-elevated">
            <h3 className="text-xs font-bold uppercase tracking-wide mb-4 border-b border-[var(--color-border)] pb-2">{t('providers_list_title')}</h3>
            <ul className="space-y-3 text-[9px] font-bold uppercase tracking-wide">
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-[var(--color-text-primary)]" /> {t('provider_resend_rec')}</li>
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-[var(--color-text-primary)]" /> {t('provider_sendgrid')}</li>
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-[var(--color-text-primary)]" /> {t('provider_smtp')}</li>
            </ul>
          </div>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

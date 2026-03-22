import { useState, useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import { Mail, ShieldCheck, Save, Send } from 'lucide-react';
import { useT } from '../../i18n';

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

  const { data: remoteConfig, isLoading } = trpc.platform.getMailConfig.useQuery();
  const updateConfig = trpc.platform.updateMailConfig.useMutation({
    onSuccess: () => alert(t('config_save_success'))
  });

  const sendTest = trpc.platform.sendTestEmail.useMutation({
    onSuccess: () => alert(t('test_email_success')),
    onError: (err) => alert(`${t('test_email_error')}: ${err.message}`)
  });

  useEffect(() => {
    if (remoteConfig) {
      setMailConfig({ ...mailConfig, ...remoteConfig });
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
    return <div className="animate-pulse space-y-4">
      <div className="h-12 bg-black/5 dark:bg-white/5 w-full" />
      <div className="h-64 bg-black/5 dark:bg-white/5 w-full" />
    </div>;
  }

  return (
    <div className="space-y-12">
      <div className="border-b-4 border-black dark:border-white pb-4">
        <h1 className="text-4xl font-black uppercase tracking-tighter">{t('system_config_title')}</h1>
        <p className="text-sm font-bold uppercase opacity-60 mt-1 tracking-widest">{t('system_config_desc')}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2 space-y-8">
          {/* Mail Configuration */}
          <section className="border-2 border-black dark:border-white p-8 bg-white dark:bg-black relative">
            <div className="absolute -top-4 left-6 bg-black dark:bg-white text-white dark:text-black px-3 py-1 text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
              <Mail size={12} /> {t('email_infra')}
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest mb-2">{t('provider_label')}</label>
                  <select 
                    value={mailConfig.provider}
                    onChange={e => setMailConfig({ ...mailConfig, provider: e.target.value })}
                    className="w-full p-3 border-2 border-black dark:border-white bg-white dark:bg-black text-black dark:text-white font-bold outline-none"
                  >
                    <option value="none">{t('provider_none')}</option>
                    <option value="smtp">{t('provider_smtp')}</option>
                    <option value="resend">{t('provider_resend')}</option>
                    <option value="sendgrid">{t('provider_sendgrid')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest mb-2">{t('sender_name')}</label>
                  <input 
                    type="text"
                    value={mailConfig.fromName}
                    onChange={e => setMailConfig({ ...mailConfig, fromName: e.target.value })}
                    placeholder="e.g. Tessera Support"
                    className="w-full p-3 border-2 border-black dark:border-white bg-transparent font-bold outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest mb-2">{t('sender_email')}</label>
                  <input 
                    type="email"
                    value={mailConfig.fromEmail}
                    onChange={e => setMailConfig({ ...mailConfig, fromEmail: e.target.value })}
                    placeholder="noreply@tessera.io"
                    className="w-full p-3 border-2 border-black dark:border-white bg-transparent font-bold outline-none"
                  />
                </div>
              </div>

              {mailConfig.provider === 'smtp' && (
                <div className="space-y-6 pt-4 border-t-2 border-black/10 dark:border-white/10">
                  <div className="grid grid-cols-3 gap-6">
                    <div className="col-span-2">
                      <label className="block text-[10px] font-black uppercase tracking-widest mb-2">{t('smtp_host')}</label>
                      <input 
                        type="text"
                        value={mailConfig.smtpHost}
                        onChange={e => setMailConfig({ ...mailConfig, smtpHost: e.target.value })}
                        className="w-full p-3 border-2 border-black dark:border-white bg-transparent font-bold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest mb-2">{t('smtp_port')}</label>
                      <input 
                        type="number"
                        value={mailConfig.smtpPort}
                        onChange={e => setMailConfig({ ...mailConfig, smtpPort: parseInt(e.target.value) })}
                        className="w-full p-3 border-2 border-black dark:border-white bg-transparent font-bold outline-none"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest mb-2">{t('smtp_user')}</label>
                      <input 
                        type="text"
                        value={mailConfig.smtpUser}
                        onChange={e => setMailConfig({ ...mailConfig, smtpUser: e.target.value })}
                        className="w-full p-3 border-2 border-black dark:border-white bg-transparent font-bold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest mb-2">{t('smtp_pass')}</label>
                      <input 
                        type="password"
                        value={mailConfig.smtpPass}
                        onChange={e => setMailConfig({ ...mailConfig, smtpPass: e.target.value })}
                        className="w-full p-3 border-2 border-black dark:border-white bg-transparent font-bold outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {(mailConfig.provider === 'resend' || mailConfig.provider === 'sendgrid') && (
                <div className="pt-4 border-t-2 border-black/10 dark:border-white/10">
                  <label className="block text-[10px] font-black uppercase tracking-widest mb-2">{t('api_key_label')}</label>
                  <input 
                    type="password"
                    value={mailConfig.apiKey}
                    onChange={e => setMailConfig({ ...mailConfig, apiKey: e.target.value })}
                    placeholder={mailConfig.provider === 'resend' ? 're_...' : 'SG....'}
                    className="w-full p-3 border-2 border-black dark:border-white bg-transparent font-bold outline-none"
                  />
                </div>
              )}

              <div className="pt-8 flex gap-4">
                <button 
                  onClick={handleSave}
                  disabled={updateConfig.isPending}
                  className="flex-1 bg-black dark:bg-white text-white dark:text-black p-4 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:invert flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                >
                  <Save size={14} /> {updateConfig.isPending ? t('saving') : t('save_config')}
                </button>
                <button 
                  disabled={mailConfig.provider === 'none'}
                  onClick={handleTestEmail}
                  className="px-8 border-2 border-black dark:border-white p-4 text-[10px] font-black uppercase tracking-widest hover:bg-black hover:text-white dark:hover:white dark:hover:text-black flex items-center gap-2 transition-all disabled:opacity-20"
                >
                  <Send size={14} /> {t('send_test')}
                </button>
              </div>
            </div>
          </section>

          {/* Identity Security Settings */}
          <section className="border-2 border-black dark:border-white p-8 bg-white dark:bg-black relative opacity-40 grayscale cursor-not-allowed">
            <div className="absolute -top-4 left-6 bg-black dark:bg-white text-white dark:text-black px-3 py-1 text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
              <ShieldCheck size={12} /> {t('identity_security')}
            </div>
            <p className="text-[10px] font-black uppercase tracking-widest text-center py-8">{t('security_locked_desc')}</p>
          </section>
        </div>

        <div className="space-y-6">
          <div className="border-2 border-black dark:border-white p-6 bg-black/5 dark:bg-white/5">
            <h3 className="text-xs font-black uppercase tracking-widest mb-4 border-b-2 border-black/10 dark:border-white/10 pb-2">{t('config_info_title')}</h3>
            <div className="space-y-4 text-[10px] font-bold uppercase tracking-tight leading-relaxed">
              <p>{t('config_info_text')}</p>
              <p className="opacity-60 italic">{t('config_verify_note')}</p>
            </div>
          </div>

          <div className="border-2 border-black dark:border-white p-6 bg-black/5 dark:bg-white/5">
            <h3 className="text-xs font-black uppercase tracking-widest mb-4 border-b-2 border-black/10 dark:border-white/10 pb-2">{t('providers_list_title')}</h3>
            <ul className="space-y-3 text-[9px] font-black uppercase tracking-widest">
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-black dark:bg-white" /> {t('provider_resend_rec')}</li>
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-black dark:bg-white" /> {t('provider_sendgrid')}</li>
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-black dark:bg-white" /> {t('provider_smtp')}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

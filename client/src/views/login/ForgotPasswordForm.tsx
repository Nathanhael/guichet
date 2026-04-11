import { useState } from 'react';
import { useT } from '../../i18n';

interface ForgotPasswordFormProps {
  onBackClick: () => void;
}

export default function ForgotPasswordForm({ onBackClick }: ForgotPasswordFormProps) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [isForgotLoading, setIsForgotLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const handleForgotPassword = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isForgotLoading) return;
    setError('');
    setIsForgotLoading(true);
    try {
      const res = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMessage(data.message);
        setEmail('');
      } else {
        setError(data.error || t('request_failed'));
      }
    } catch (err) {
      setError(t('network_error'));
    } finally {
      setIsForgotLoading(false);
    }
  };

  if (successMessage) {
    return (
      <div className="p-8 space-y-6 bg-[var(--color-bg-surface)]">
        <div className="space-y-6 text-center py-8">
          <div className="w-16 h-16 border border-[var(--color-border-heavy)] flex items-center justify-center mx-auto text-2xl font-bold italic text-[var(--color-text-primary)]">✓</div>
          <p className="mono-label text-[var(--color-text-secondary)] leading-relaxed px-4">{successMessage}</p>
          <button onClick={onBackClick} className="mono-label text-[var(--color-text-muted)] underline underline-offset-4 hover:text-[var(--color-text-primary)]">{t('back_to_login')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6 bg-[var(--color-bg-surface)]">
      <form onSubmit={handleForgotPassword} className="space-y-6">
        <p className="mono-label text-[var(--color-text-secondary)] leading-relaxed">{t('reset_password_desc')}</p>
        {error && (
          <div className="p-3 border border-[var(--color-accent-red)] text-[var(--color-accent-red)] flex items-center gap-3">
            <span className="text-lg font-bold">!</span>
            <p className="mono-label">{error}</p>
          </div>
        )}
        <div>
          <label className="mono-label block mb-1.5 text-[var(--color-text-secondary)]">{t('email_label')}</label>
          <input type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }} className="input-field w-full" placeholder={t('placeholder_email')} required disabled={isForgotLoading} />
        </div>
        <button type="submit" disabled={isForgotLoading} className="btn-primary w-full flex items-center justify-center gap-3">
          {isForgotLoading ? t('loading') : t('send_reset_link')}
        </button>
        <button type="button" onClick={onBackClick} className="w-full mono-label text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">{t('cancel')}</button>
      </form>
    </div>
  );
}

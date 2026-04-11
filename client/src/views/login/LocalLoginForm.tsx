import { useState } from 'react';
import { useT } from '../../i18n';
import { Eye, EyeOff } from 'lucide-react';
import type { User, Membership } from '../../types';

interface LocalLoginFormProps {
  onLoginSuccess: (user: User, memberships: Membership[]) => void;
  onMfaRequired: (endpoint: string, body: Record<string, unknown>, passwordRef: string) => void;
  onForgotClick: () => void;
  onBackClick: () => void;
}

export default function LocalLoginForm({ onLoginSuccess, onMfaRequired, onForgotClick, onBackClick }: LocalLoginFormProps) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoginLoading, setIsLoginLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLocalLogin = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isLoginLoading) return;
    setError('');
    setIsLoginLoading(true);
    try {
      const res = await fetch('/api/v1/auth/login-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, rememberMe })
      });
      const data = await res.json();
      if (data.mfaRequired) {
          onMfaRequired('/api/v1/auth/login-local', { email, rememberMe }, password);
      } else if (res.ok) {
          setPassword('');
          onLoginSuccess(data.user, data.memberships || []);
      } else {
          setError(data.error || t('login_failed'));
      }
    } catch (err) {
      setError(t('network_error'));
    } finally {
      setIsLoginLoading(false);
    }
  };

  return (
    <div className="p-8 space-y-6 bg-[var(--color-bg-surface)]">
      <button
        type="button"
        onClick={onBackClick}
        className="mono-label text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] flex items-center gap-1.5"
      >
        <span>←</span>
        <span>{t('back_to_sso')}</span>
      </button>
      <form onSubmit={handleLocalLogin} className="space-y-5">
        {error && (
          <div className="p-3 border border-[var(--color-accent-red)] text-[var(--color-accent-red)] flex items-center gap-3">
            <span className="text-lg font-bold">!</span>
            <p className="mono-label">{error}</p>
          </div>
        )}
        <div>
          <label className="mono-label block mb-1.5 text-[var(--color-text-secondary)]">{t('email_label')}</label>
          <input type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }} className="input-field w-full" placeholder={t('placeholder_email')} required disabled={isLoginLoading} />
        </div>
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="mono-label text-[var(--color-text-secondary)]">{t('password_label')}</label>
            <button type="button" onClick={onForgotClick} className="mono-label text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:underline">{t('forgot_password')}</button>
          </div>
          <div className="relative">
            <input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} className="input-field w-full pr-12" placeholder="••••••••" required disabled={isLoginLoading} />
            <button 
              type="button" 
              onClick={() => setShowPassword(prev => !prev)} 
              aria-label={showPassword ? t('hide_password') : t('show_password')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)] cursor-pointer hover:text-[var(--color-text-primary)]"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 py-1">
          <div className="relative flex items-center">
            <input id="remember" type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} className="w-4 h-4 border border-[var(--color-border)] bg-[var(--color-bg-surface)] appearance-none cursor-pointer checked:bg-[var(--color-text-primary)]" />
            {rememberMe && <span className="absolute inset-0 flex items-center justify-center pointer-events-none text-[var(--color-bg-base)] font-bold text-xs">✓</span>}
          </div>
          <label htmlFor="remember" className="mono-label cursor-pointer text-[var(--color-text-muted)] select-none">{t('remember_me')}</label>
        </div>
        <button type="submit" disabled={isLoginLoading} className="btn-primary w-full flex items-center justify-center gap-3">
          {isLoginLoading ? <span>{t('authenticating')}</span> : <><span>{t('login_btn')}</span><span>➔</span></>}
        </button>
      </form>
    </div>
  );
}

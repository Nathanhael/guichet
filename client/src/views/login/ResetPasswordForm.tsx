import { useState } from 'react';
import { useT } from '../../i18n';
import { Eye, EyeOff } from 'lucide-react';

interface ResetPasswordFormProps {
  resetToken: string;
  onSuccess: () => void;
}

export default function ResetPasswordForm({ resetToken, onSuccess }: ResetPasswordFormProps) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isResetLoading, setIsResetLoading] = useState(false);
  const [error, setError] = useState('');

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isResetLoading) return;
    setError('');
    setIsResetLoading(true);
    try {
      const res = await fetch('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token: resetToken, password })
      });
      const data = await res.json();
      if (res.ok) {
        onSuccess();
      } else {
        setError(data.error || t('reset_failed'));
      }
    } catch (err) {
      setError(t('network_error'));
    } finally {
      setIsResetLoading(false);
    }
  };

  return (
    <div className="p-8 space-y-6 bg-[var(--color-bg-surface)]">
      <form onSubmit={handleResetPassword} className="space-y-6">
        <p className="mono-label text-[var(--color-text-secondary)] leading-relaxed">{t('new_password_desc')}</p>
        {error && (
          <div className="p-3 border border-[var(--color-accent-red)] text-[var(--color-accent-red)] flex items-center gap-3">
            <span className="text-lg font-bold">!</span>
            <p className="mono-label">{error}</p>
          </div>
        )}
        <div>
          <label className="mono-label block mb-1.5 text-[var(--color-text-secondary)]">{t('password_label')}</label>
          <div className="relative">
            <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} className="input-field w-full pr-12" placeholder="••••••••" required disabled={isResetLoading} />
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
        <button type="submit" disabled={isResetLoading} className="btn-primary w-full flex items-center justify-center gap-3">
          {isResetLoading ? t('loading') : t('update_password_btn')}
        </button>
      </form>
    </div>
  );
}

import { useState, type RefObject } from 'react';
import { useT } from '../../i18n';
import { ShieldCheck } from 'lucide-react';
import type { User, Membership } from '../../types';

interface MfaChallengeProps {
  endpoint: string;
  body: Record<string, unknown>;
  passwordRef: RefObject<string>;
  onSuccess: (user: User, memberships: Membership[]) => void;
  onCancel: () => void;
}

export default function MfaChallenge({ endpoint, body, passwordRef, onSuccess, onCancel }: MfaChallengeProps) {
  const t = useT();
  const [totpCode, setTotpCode] = useState('');
  const [isLoginLoading, setIsLoginLoading] = useState(false);
  const [error, setError] = useState('');

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoginLoading) return;
    setError('');
    setIsLoginLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...body, password: passwordRef.current, totpCode })
      });
      const data = await res.json();
      if (res.ok) {
        onSuccess(data.user, data.memberships || []);
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
      <div className="flex items-center gap-3 mb-2">
        <ShieldCheck className="h-5 w-5 text-[var(--color-text-secondary)]" />
        <span className="mono-label text-[var(--color-text-secondary)]">{t('mfa_title')}</span>
      </div>
      <form onSubmit={handleMfaVerify} className="space-y-6">
        <p className="mono-label text-[var(--color-text-secondary)] leading-relaxed">
          {t('mfa_instruction')}
        </p>
        {error && (
          <div className="p-3 border border-[var(--color-accent-red)] text-[var(--color-accent-red)] flex items-center gap-3">
            <span className="text-lg font-bold">!</span>
            <p className="mono-label">{error}</p>
          </div>
        )}
        <div>
          <label className="mono-label block mb-1.5 text-[var(--color-text-secondary)]">{t('verification_code') || 'Verification Code'}</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={totpCode}
            onChange={e => { setTotpCode(e.target.value); setError(''); }}
            className="input-field w-full font-mono text-center text-lg tracking-[0.3em]"
            placeholder="000000"
            required
            disabled={isLoginLoading}
            autoFocus
          />
        </div>
        <button type="submit" disabled={isLoginLoading || totpCode.trim().length < 6} className="btn-primary w-full flex items-center justify-center gap-3">
          {isLoginLoading ? <span>{t('authenticating')}</span> : <><span>{t('verify_btn')}</span><span>➔</span></>}
        </button>
        <button type="button" onClick={onCancel} className="w-full mono-label text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
          {t('cancel')}
        </button>
      </form>
    </div>
  );
}

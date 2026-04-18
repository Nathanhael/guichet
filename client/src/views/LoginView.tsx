import { useState, useEffect, useCallback } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import { useStoreShallow } from '../store/useStore';
import { useT } from '../i18n';
import { APP_NAME } from '../constants';
import type { User, Membership, UserRole } from '../types';
import DarkModeToggle from '../components/DarkModeToggle';
import LanguageSwitcher from '../components/LanguageSwitcher';
import SystemBackground from '../components/SystemBackground';
import LegalModal from '../components/LegalModal';
import { getRoleDisplayName } from '../utils/roles';

import DemoUserPicker from './login/DemoUserPicker';

type PartnerSelection = {
  user: User;
  memberships: Membership[];
};

type AuthViewMode = 'sso-selection' | 'demo';

export default function LoginView() {
  const { setUser, setMemberships, setActiveMembershipId } = useStoreShallow((s) => ({
    setUser: s.setUser,
    setMemberships: s.setMemberships,
    setActiveMembershipId: s.setActiveMembershipId,
  }));
  const t = useT();
  const [selectingPartner, setSelectingPartner] = useState<PartnerSelection | null>(null);

  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [viewMode, setViewMode] = useState<AuthViewMode>('sso-selection');

  const [legalModal, setLegalModal] = useState<'privacy' | 'terms' | null>(null);

  const [isSsoVerifying, setIsSsoVerifying] = useState(false);

  const handleLoginSuccess = useCallback((user: User, memberships: Membership[], preferredMembershipId?: string) => {
    if (memberships.length > 1 && !user.isPlatformOperator && !preferredMembershipId) {
      setSelectingPartner({ user, memberships });
    } else {
      setUser(user);
      setMemberships(memberships);
      if (memberships.length > 0 && !user.isPlatformOperator) {
        setActiveMembershipId(preferredMembershipId || memberships[0].id);
      }
    }
  }, [setUser, setMemberships, setActiveMembershipId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const ssoError = params.get('sso_error');
    if (ssoError) {
      const ssoErrorMessages: Record<string, string> = {
        'no_matching_groups': t('sso_no_groups_message'),
        'invalid_token': t('login_failed'),
        'expired': t('login_failed'),
        'unauthorized': t('login_failed'),
        'server_error': t('login_failed'),
        'guest_multi_partner_mapping': t('sso_guest_multi_partner_message'),
        'invite_expired': t('sso_invite_expired_message'),
      };
      setError(ssoErrorMessages[ssoError] || t('login_failed'));
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const hash = window.location.hash;
    if (hash.startsWith('#sso_callback=')) {
      setIsSsoVerifying(true);
      window.history.replaceState({}, document.title, window.location.pathname);
      fetch('/api/v1/auth/me', { credentials: 'include' })
        .then(async (res) => {
          if (!res.ok) throw new Error('SSO session verification failed');
          const data = await res.json();
          handleLoginSuccess(data.user, data.memberships || []);
        })
        .catch((err) => {
          console.error('[SSO] Failed to verify session with server', err);
          setError('SSO login failed');
        })
        .finally(() => {
          setIsSsoVerifying(false);
        });
    }
  }, [handleLoginSuccess, t]);

  if (isSsoVerifying) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[var(--color-bg-base)]">
        <div className="mono-label text-[10px]">{t('loading') || 'Loading...'}</div>
      </div>
    );
  }

  if (selectingPartner) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-[var(--color-text-primary)] relative">
        <SystemBackground />
        <div className="w-full max-w-lg overflow-hidden relative z-10 border border-[var(--color-border-heavy)] bg-[var(--color-bg-surface)]">
          <div className="bg-[var(--color-text-primary)] px-8 py-10" style={{ color: 'var(--color-bg-base)' }}>
            <h1 className="text-xl font-mono font-bold uppercase tracking-[3px]">{t('choose_workspace')}</h1>
            <p className="mono-label mt-2" style={{ opacity: 0.8 }}>{selectingPartner.user.name}</p>
          </div>
          <div className="p-6 space-y-3">
            {selectingPartner.memberships.map((m) => (
              <button
                key={m.id}
                onClick={() => { setUser(selectingPartner.user); setMemberships(selectingPartner.memberships); setActiveMembershipId(m.id); }}
                className="group w-full text-left p-4 border-2 border-[var(--color-border-heavy)] hover:bg-[var(--color-text-primary)] hover:text-[var(--color-bg-base)] flex items-center justify-between"
              >
                <div>
                  <p className="font-mono font-bold uppercase tracking-tight text-[var(--color-text-primary)] group-hover:text-[var(--color-bg-base)]">{m.partnerName}</p>
                  <p className="mono-label text-[var(--color-text-secondary)] group-hover:text-[var(--color-bg-base)] mt-0.5">{getRoleDisplayName(m.role as UserRole, false)} · {m.manifest?.industry}</p>
                </div>
                <span className="text-xl font-bold text-[var(--color-text-secondary)] group-hover:text-[var(--color-bg-base)]">➔</span>
              </button>
            ))}
            <button
              onClick={() => setSelectingPartner(null)}
              className="w-full py-3 mt-4 mono-label text-[var(--color-text-muted)] border border-transparent hover:border-[var(--color-border)] hover:text-[var(--color-text-primary)]"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
    <div className="min-h-screen flex flex-col items-center justify-center p-6 text-[var(--color-text-primary)] relative">
      <SystemBackground />
      <div className="absolute top-6 right-6 z-50 flex items-center gap-2 bg-[var(--color-bg-elevated)] p-1 border border-[var(--color-border)]">
        <LanguageSwitcher />
        <DarkModeToggle />
      </div>

      <div className="w-full max-w-lg overflow-hidden relative z-10 border border-[var(--color-border-heavy)] bg-[var(--color-bg-surface)]">
        <div className="bg-[var(--color-text-primary)] px-8 py-10 relative overflow-hidden flex justify-between items-start" style={{ color: 'var(--color-bg-base)' }}>
          <div className="flex flex-col items-start gap-4">
            <img
              src="/icon-blue.svg"
              className="w-12 h-12 select-none"
              alt={APP_NAME}
            />
            <h1 className="text-3xl font-mono font-bold uppercase tracking-[4px] relative z-10 cursor-default select-none focus:outline-none">
              {APP_NAME}
            </h1>
            <p className="mono-label relative z-10" style={{ opacity: 0.8 }}>
              {viewMode === 'sso-selection' ? t('sso_login_description') : t('select_user')}
            </p>
          </div>
          {viewMode === 'demo' && (
            <button
              onClick={() => { setError(''); setSuccessMessage(''); setViewMode('sso-selection'); }}
              className="mono-label border border-current px-3 py-1.5 hover:bg-[var(--color-bg-base)] hover:text-[var(--color-text-primary)]"
              style={{ color: 'inherit' }}
            >
              {t('standard_login')}
            </button>
          )}
        </div>

        {viewMode === 'sso-selection' && (
          <div className="p-8 space-y-6 bg-[var(--color-bg-surface)]">
            {error && (
              <div className="p-3 border border-[var(--color-accent-red)] text-[var(--color-accent-red)] flex items-center gap-3">
                <span className="text-lg font-bold">!</span>
                <p className="mono-label">{error}</p>
              </div>
            )}
            {successMessage && (
              <div className="p-3 border border-[var(--color-accent-green)] text-[var(--color-accent-green)] flex items-center gap-3">
                <span className="text-lg font-bold">✓</span>
                <p className="mono-label">{successMessage}</p>
              </div>
            )}
            <p className="mono-label text-[var(--color-text-secondary)] leading-relaxed">{t('sso_login_description')}</p>
            <button
              onClick={() => { window.location.href = '/api/v1/auth/sso/azure'; }}
              className="w-full py-3 bg-[var(--color-text-primary)] text-[var(--color-bg-base)] font-mono font-bold uppercase tracking-widest text-sm hover:bg-[var(--color-accent-blue)] hover:text-white flex items-center justify-center gap-4"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden="true"><path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zm12.6 0H12.6V0H24v11.4z" /></svg>
              <span>{t('sso_microsoft')}</span>
            </button>
            <div className="text-center pt-2 flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => { setViewMode('demo'); setError(''); setSuccessMessage(''); }}
                className="mono-label text-[var(--color-accent-blue)] hover:text-[var(--color-text-primary)] hover:underline underline-offset-4"
              >
                {t('demo_mode')}
              </button>
            </div>
          </div>
        )}

        {viewMode === 'demo' && (
          <DemoUserPicker onLoginSuccess={handleLoginSuccess} />
        )}
      </div>

      <div className="mt-12 flex gap-8 text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)]">
        <button onClick={() => setLegalModal('privacy')} className="mono-label hover:underline">{t('privacy_policy')}</button>
        <button onClick={() => setLegalModal('terms')} className="mono-label hover:underline">{t('terms_of_service')}</button>
      </div>
      {legalModal && <LegalModal type={legalModal} onClose={() => setLegalModal(null)} />}
    </div>
    </ErrorBoundary>
  );
}

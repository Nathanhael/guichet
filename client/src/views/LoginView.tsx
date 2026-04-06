import { useState, useEffect, useRef, useCallback } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import { useStoreShallow } from '../store/useStore';
import { useT } from '../i18n';
import type { User, Membership, UserRole } from '../types';
import DarkModeToggle from '../components/DarkModeToggle';
import LanguageSwitcher from '../components/LanguageSwitcher';
import SystemBackground from '../components/SystemBackground';
import LegalModal from '../components/LegalModal';
import { getRoleDisplayName } from '../utils/roles';

// Sub-components
import LocalLoginForm from './login/LocalLoginForm';
import ForgotPasswordForm from './login/ForgotPasswordForm';
import ResetPasswordForm from './login/ResetPasswordForm';
import MfaChallenge from './login/MfaChallenge';
import DemoUserPicker from './login/DemoUserPicker';

type PartnerSelection = {
  user: User;
  memberships: Membership[];
};

type AuthViewMode = 'sso-selection' | 'platform-login' | 'demo' | 'forgot' | 'reset' | 'mfa';

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
  const [logoClicks, setLogoClicks] = useState(0);
  const [showAdminLoginLink, setShowAdminLoginLink] = useState(false);
  const logoClickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLogoClick = () => {
    if (logoClickTimeoutRef.current) clearTimeout(logoClickTimeoutRef.current);
    const next = logoClicks + 1;
    if (next >= 3) {
      setShowAdminLoginLink(true);
      setLogoClicks(0);
    } else {
      setLogoClicks(next);
      logoClickTimeoutRef.current = setTimeout(() => setLogoClicks(0), 500);
    }
  };

  useEffect(() => {
    return () => {
      if (logoClickTimeoutRef.current) clearTimeout(logoClickTimeoutRef.current);
    };
  }, []);

  const [resetToken, setResetToken] = useState('');
  const [legalModal, setLegalModal] = useState<'privacy' | 'terms' | null>(null);

  // Pending MFA login context
  const mfaPasswordRef = useRef<string>('');
  const [mfaPending, setMfaPending] = useState<{
    endpoint: string;
    body: Record<string, unknown>;
  } | null>(null);

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
    // Handle password reset token from URL query
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      setResetToken(token);
      setViewMode('reset');
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Handle SSO error from URL query
    const ssoError = params.get('sso_error');
    if (ssoError) {
      const ssoErrorMessages: Record<string, string> = {
        'no_matching_groups': t('sso_no_groups_message'),
        'invalid_token': t('login_failed'),
        'expired': t('login_failed'),
        'unauthorized': t('login_failed'),
        'server_error': t('login_failed'),
      };
      setError(ssoErrorMessages[ssoError] || t('login_failed'));
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Handle SSO callback from URL hash fragment
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

  const handleMfaRequired = (endpoint: string, body: Record<string, unknown>, passwordRef: string) => {
    mfaPasswordRef.current = passwordRef;
    setMfaPending({ endpoint, body });
    setViewMode('mfa');
    setError('');
  };

  const cancelMfa = () => {
    setViewMode('sso-selection');
    setMfaPending(null);
    mfaPasswordRef.current = '';
    setError('');
  };

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
          <div>
            <h1 
              onClick={handleLogoClick}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleLogoClick();
                }
              }}
              tabIndex={0}
              role="button"
              aria-label="Tessera"
              className="text-5xl font-mono font-bold uppercase tracking-tighter italic relative z-10 cursor-default select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-bg-base)]"
            >
              Tessera
            </h1>
            <p className="mono-label mt-2 relative z-10" style={{ opacity: 0.8 }}>
              {viewMode === 'sso-selection' ? t('sso_login_description') :
               viewMode === 'platform-login' ? t('secure_auth') :
               viewMode === 'forgot' ? t('reset_password_title') :
               viewMode === 'reset' ? t('create_new_password') :
               viewMode === 'mfa' ? (t('verify_identity') || 'Verify Identity') :
               t('select_user')}
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
            {/* TODO: Replace /api/v1/auth/sso/login with the correct universal SSO endpoint when available */}
            <button
              onClick={() => { window.location.href = '/api/v1/auth/sso/azure'; }}
              className="w-full py-3 bg-[var(--color-text-primary)] text-[var(--color-bg-base)] font-mono font-bold uppercase tracking-widest text-sm hover:bg-[var(--color-accent-blue)] hover:text-white flex items-center justify-center gap-4"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zm12.6 0H12.6V0H24v11.4z" /></svg>
              <span>{t('sign_in_sso')}</span>
            </button>
            <div className="text-center pt-2 flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => { setViewMode('demo'); setError(''); setSuccessMessage(''); }}
                className="mono-label text-[var(--color-accent-blue)] hover:text-[var(--color-text-primary)] hover:underline underline-offset-4"
              >
                {t('demo_mode')}
              </button>
              {showAdminLoginLink && (
                <button
                  type="button"
                  onClick={() => { setViewMode('platform-login'); setError(''); setSuccessMessage(''); }}
                  className="mono-label text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:underline underline-offset-4"
                >
                  {t('platform_admin_login')}
                </button>
              )}
            </div>
          </div>
        )}

        {viewMode === 'platform-login' && (
          <LocalLoginForm 
            onLoginSuccess={handleLoginSuccess}
            onMfaRequired={handleMfaRequired}
            onForgotClick={() => { setViewMode('forgot'); setError(''); setSuccessMessage(''); }}
            onBackClick={() => { setViewMode('sso-selection'); setError(''); setSuccessMessage(''); }}
          />
        )}

        {viewMode === 'forgot' && (
          <ForgotPasswordForm 
            onBackClick={() => { setViewMode('sso-selection'); setError(''); }}
          />
        )}

        {viewMode === 'reset' && (
          <ResetPasswordForm
            resetToken={resetToken}
            onSuccess={() => {
              setSuccessMessage(t('password_updated') || 'Password updated successfully');
              setViewMode('sso-selection');
            }}
            onBackClick={() => { setViewMode('sso-selection'); setError(''); }}
          />
        )}

        {viewMode === 'mfa' && mfaPending && (
          <MfaChallenge
            endpoint={mfaPending.endpoint}
            body={mfaPending.body}
            passwordRef={mfaPasswordRef}
            onSuccess={handleLoginSuccess}
            onCancel={cancelMfa}
          />
        )}

        {viewMode === 'demo' && (
          <DemoUserPicker
            onLoginSuccess={handleLoginSuccess}
            onMfaRequired={handleMfaRequired}
          />
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

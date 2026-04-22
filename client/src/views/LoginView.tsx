import { useState, useEffect, useCallback } from 'react';
import { ArrowRight, AlertCircle, CheckCircle2 } from 'lucide-react';
import ErrorBoundary from '../components/ErrorBoundary';
import { useStoreShallow } from '../store/useStore';
import { useT } from '../i18n';
import { APP_NAME } from '../constants';
import type { User, Membership, UserRole } from '../types';
import DarkModeToggle from '../components/DarkModeToggle';
import LanguageSwitcher from '../components/LanguageSwitcher';
import SystemBackground from '../components/SystemBackground';
import LegalModal from '../components/LegalModal';
import Button from '../components/ui/Button';
import { getRoleDisplayName } from '../utils/roles';

import DemoUserPicker from './login/DemoUserPicker';

type PartnerSelection = {
  user: User;
  memberships: Membership[];
};

type AuthViewMode = 'sso-selection' | 'demo';

const SHELL =
  'w-full max-w-md overflow-hidden relative z-10 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)]';

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

  // Mount-time: harvest SSO error / callback params from the URL and sync to
  // local state. External→React state sync; must happen after mount because
  // window.location is a browser-only API.
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin" />
          <p className="text-[13px] text-[var(--color-ink-soft)]">{t('loading') || 'Loading...'}</p>
        </div>
      </div>
    );
  }

  if (selectingPartner) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 relative">
        <SystemBackground />
        <div className={SHELL}>
          <div className="px-7 pt-7 pb-5">
            <h1 className="text-[20px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">
              {t('choose_workspace')}
            </h1>
            <p className="text-[13px] text-[var(--color-ink-muted)] mt-1">{selectingPartner.user.name}</p>
          </div>
          <div className="px-7 pb-7 space-y-2">
            {selectingPartner.memberships.map((m) => (
              <button
                key={m.id}
                onClick={() => { setUser(selectingPartner.user); setMemberships(selectingPartner.memberships); setActiveMembershipId(m.id); }}
                className="group w-full text-left px-4 py-3 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-accent)] hover:bg-[var(--color-hover)] transition-colors flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-[var(--color-ink)] truncate">{m.partnerName}</p>
                  <p className="text-[12px] text-[var(--color-ink-muted)] mt-0.5 truncate">
                    {getRoleDisplayName(m.role as UserRole, false)}
                    {m.manifest?.industry ? ` · ${m.manifest.industry}` : ''}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-[var(--color-ink-muted)] group-hover:text-[var(--color-accent)] shrink-0" />
              </button>
            ))}
            <div className="pt-2">
              <Button
                variant="ghost"
                size="md"
                onClick={() => setSelectingPartner(null)}
                className="w-full"
              >
                {t('cancel')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen flex flex-col items-center justify-center p-6 relative">
        <SystemBackground />
        <div className="absolute top-5 right-5 z-50 flex items-center gap-1 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)] p-1">
          <LanguageSwitcher />
          <DarkModeToggle />
        </div>

        <div className={SHELL}>
          <div className="px-7 pt-7 pb-5 flex items-start justify-between gap-4">
            <div className="flex flex-col items-start gap-3">
              <img
                src="/icon-blue.svg"
                className="w-10 h-10 select-none"
                alt={APP_NAME}
              />
              <div>
                <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[var(--color-ink)] select-none">
                  {APP_NAME}
                </h1>
                <p className="text-[13px] text-[var(--color-ink-muted)] mt-1">
                  {viewMode === 'sso-selection' ? t('sso_login_description') : t('select_user')}
                </p>
              </div>
            </div>
            {viewMode === 'demo' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setError(''); setSuccessMessage(''); setViewMode('sso-selection'); }}
              >
                {t('standard_login')}
              </Button>
            )}
          </div>

          {viewMode === 'sso-selection' && (
            <div className="px-7 pb-7 space-y-4">
              {error && (
                <div className="rounded-[var(--radius-btn)] bg-[var(--color-urgent-soft)] border border-[var(--color-urgent)]/30 px-3 py-2.5 flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 text-[var(--color-urgent)] mt-0.5 shrink-0" />
                  <p className="text-[13px] text-[var(--color-urgent)]">{error}</p>
                </div>
              )}
              {successMessage && (
                <div className="rounded-[var(--radius-btn)] bg-[var(--color-ok-soft)] border border-[var(--color-ok)]/30 px-3 py-2.5 flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[var(--color-ok)] mt-0.5 shrink-0" />
                  <p className="text-[13px] text-[var(--color-ok)]">{successMessage}</p>
                </div>
              )}

              <Button
                variant="primary"
                size="md"
                onClick={() => { window.location.href = '/api/v1/auth/sso/azure'; }}
                className="w-full h-11"
                leading={
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
                    <path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zm12.6 0H12.6V0H24v11.4z" />
                  </svg>
                }
              >
                {t('sso_microsoft')}
              </Button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => { setViewMode('demo'); setError(''); setSuccessMessage(''); }}
                  className="text-[12px] font-medium text-[var(--color-accent)] hover:underline underline-offset-4"
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

        <div className="mt-10 flex gap-6">
          <button
            onClick={() => setLegalModal('privacy')}
            className="text-[12px] text-[var(--color-ink-muted)] hover:text-[var(--color-ink-soft)] hover:underline underline-offset-4"
          >
            {t('privacy_policy')}
          </button>
          <button
            onClick={() => setLegalModal('terms')}
            className="text-[12px] text-[var(--color-ink-muted)] hover:text-[var(--color-ink-soft)] hover:underline underline-offset-4"
          >
            {t('terms_of_service')}
          </button>
        </div>
        {legalModal && <LegalModal type={legalModal} onClose={() => setLegalModal(null)} />}
      </div>
    </ErrorBoundary>
  );
}

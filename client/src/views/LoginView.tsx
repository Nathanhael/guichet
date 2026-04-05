import { useState, useEffect, useRef } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import { useStoreShallow } from '../store/useStore';
import { useT } from '../i18n';
import type { User, Membership, UserRole } from '../types';
import DarkModeToggle from '../components/DarkModeToggle';
import LanguageSwitcher from '../components/LanguageSwitcher';
import SystemBackground from '../components/SystemBackground';
import { trpc } from '../utils/trpc';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import LegalModal from '../components/LegalModal';
import { LANG_LABEL } from '../constants';
import { getRoleDisplayName } from '../utils/roles';

type DemoUser = { id: string; name: string; email?: string; role?: string; lang?: string; isPlatformOperator?: boolean };

type PartnerSelection = {
  user: User;
  memberships: Membership[];
};

export default function LoginView() {
  const { setUser, setMemberships, setActiveMembershipId } = useStoreShallow((s) => ({
    setUser: s.setUser,
    setMemberships: s.setMemberships,
    setActiveMembershipId: s.setActiveMembershipId,
  }));
  const t = useT();
  const [filter, setFilter] = useState<'all' | 'platform' | 'support' | 'admin' | 'agent'>('all');
  const [selectingPartner, setSelectingPartner] = useState<PartnerSelection | null>(null);

  const busyRef = useRef(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoginLoading, setIsLoginLoading] = useState(false);
  const [isForgotLoading, setIsForgotLoading] = useState(false);
  const [isResetLoading, setIsResetLoading] = useState(false);
  const [isDemoLoading, setIsDemoLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [viewMode, setViewMode] = useState<'standard' | 'demo' | 'forgot' | 'reset' | 'mfa'>('standard');
  const [showPlatformLogin, setShowPlatformLogin] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [legalModal, setLegalModal] = useState<'privacy' | 'terms' | null>(null);
  const [totpCode, setTotpCode] = useState('');
  // Pending MFA login context (password kept in ref to avoid React state/DevTools exposure)
  const mfaPasswordRef = useRef<string>('');
  const [mfaPending, setMfaPending] = useState<{
    endpoint: string;
    body: Record<string, unknown>;
  } | null>(null);

  const { data: usersData } = trpc.user.demoList.useQuery(undefined, {
    enabled: viewMode === 'demo'
  });
  const demoLoginMutation = trpc.user.demoLogin.useMutation();
  const users: DemoUser[] = usersData ? (usersData as DemoUser[]) : [];

  const filtered = filter === 'all' ? users :
    filter === 'platform' ? users.filter((u: DemoUser) => u.isPlatformOperator) :
    filter === 'support' ? users.filter((u: DemoUser) => u.role === 'support') :
    filter === 'admin' ? users.filter((u: DemoUser) => u.role === 'admin' && !u.isPlatformOperator) :
    filter === 'agent' ? users.filter((u: DemoUser) => u.role === 'agent') :
    users;

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
    // Instead of trusting the hash payload directly, we verify by fetching from the server
    const hash = window.location.hash;
    if (hash.startsWith('#sso_callback=')) {
      window.history.replaceState({}, document.title, window.location.pathname);
      fetch('/api/v1/auth/me', { credentials: 'include' })
        .then(async (res) => {
          if (!res.ok) throw new Error('SSO session verification failed');
          const data = await res.json();
          const verifiedUser: User = data.user;
          const verifiedMemberships: Membership[] = data.memberships || [];
          if (verifiedMemberships.length > 1 && !verifiedUser.isPlatformOperator) {
            setSelectingPartner({ user: verifiedUser, memberships: verifiedMemberships });
          } else {
            setUser(verifiedUser);
            setMemberships(verifiedMemberships);
            if (verifiedMemberships.length > 0 && !verifiedUser.isPlatformOperator) {
              setActiveMembershipId(verifiedMemberships[0].id);
            }
          }
        })
        .catch((err) => {
          console.error('[SSO] Failed to verify session with server', err);
          setError('SSO login failed');
        });
    }
  }, []);

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current || isLoginLoading) return;
    busyRef.current = true;
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
      if (res.ok) {
        if (data.mfaRequired) {
          // MFA challenge — store credentials and switch to MFA view
          mfaPasswordRef.current = password;
          setMfaPending({ endpoint: '/api/v1/auth/login-local', body: { email, rememberMe } });
          setViewMode('mfa');
          setTotpCode('');
          setError('');
        } else {
          setPassword('');
          const memberships = data.memberships || [];
          if (memberships.length > 1 && !data.user.isPlatformOperator) {
            setSelectingPartner({ user: data.user, memberships });
          } else {
            setUser(data.user);
            setMemberships(memberships);
            if (memberships.length > 0 && !data.user.isPlatformOperator) {
              setActiveMembershipId(memberships[0].id);
            }
          }
        }
      } else {
        setError(data.error || t('login_failed'));
      }
    } catch (err) {
      setError(t('network_error'));
    } finally {
      busyRef.current = false;
      setIsLoginLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
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
        setSuccessMessage(data.message);
        setViewMode('standard');
        setPassword('');
      } else {
        setError(data.error || t('reset_failed'));
      }
    } catch (err) {
      setError(t('network_error'));
    } finally {
      setIsResetLoading(false);
    }
  };

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaPending || busyRef.current || isLoginLoading) return;
    busyRef.current = true;
    setError('');
    setIsLoginLoading(true);
    try {
      const res = await fetch(mfaPending.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...mfaPending.body, password: mfaPasswordRef.current, totpCode })
      });
      const data = await res.json();
      if (res.ok) {
        setPassword('');
        setTotpCode('');
        setMfaPending(null);
        mfaPasswordRef.current = '';
        const memberships = data.memberships || [];
        if (memberships.length > 1 && !data.user.isPlatformOperator) {
          setSelectingPartner({ user: data.user, memberships });
        } else {
          setUser(data.user);
          setMemberships(memberships);
          if (memberships.length > 0 && !data.user.isPlatformOperator) {
            setActiveMembershipId(memberships[0].id);
          }
        }
      } else {
        setError(data.error || t('login_failed'));
      }
    } catch (err) {
      setError(t('network_error'));
    } finally {
      busyRef.current = false;
      setIsLoginLoading(false);
    }
  };

  const handleDemoLogin = async (u: DemoUser) => {
    if (busyRef.current || isDemoLoading) return;
    busyRef.current = true;
    setError('');
    setIsDemoLoading(true);
    try {
      const { password: demoPassword } = await demoLoginMutation.mutateAsync({ email: u.email! });
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: u.id, password: demoPassword })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.mfaRequired) {
          mfaPasswordRef.current = demoPassword;
          setMfaPending({ endpoint: '/api/v1/auth/login', body: { id: u.id } });
          setViewMode('mfa');
          setTotpCode('');
          setError('');
        } else {
          const memberships = data.memberships || [];
          if (memberships.length > 1 && !data.user.isPlatformOperator) {
            setSelectingPartner({ user: data.user, memberships });
          } else {
            setUser(data.user);
            setMemberships(memberships);
            if (memberships.length > 0 && !data.user.isPlatformOperator) {
              setActiveMembershipId(memberships[0].id);
            }
          }
        }
      } else {
         const errData = await res.json();
         setError(errData.error || t('login_failed'));
      }
    } catch (err) {
      console.error(err);
      setError(t('network_error'));
    } finally {
      busyRef.current = false;
      setIsDemoLoading(false);
    }
  };

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
                className="w-full text-left p-4 border-2 border-[var(--color-border-heavy)] hover:bg-[var(--color-text-primary)] hover:text-[var(--color-bg-base)] flex items-center justify-between"
              >
                <div>
                  <p className="font-mono font-bold uppercase tracking-tight text-[var(--color-text-primary)]">{m.partnerName}</p>
                  <p className="mono-label text-[var(--color-text-secondary)] mt-0.5">{getRoleDisplayName(m.role as UserRole, false)} · {m.manifest?.industry}</p>
                </div>
                <span className="text-xl font-bold text-[var(--color-text-secondary)]">➔</span>
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
            <h1 className="text-5xl font-mono font-bold uppercase tracking-tighter italic relative z-10">Tessera</h1>
            <p className="mono-label mt-2 relative z-10" style={{ opacity: 0.8 }}>
              {viewMode === 'standard' && !showPlatformLogin ? t('sso_login_description') :
               viewMode === 'standard' && showPlatformLogin ? t('secure_auth') :
               viewMode === 'forgot' ? t('reset_password_title') :
               viewMode === 'reset' ? t('create_new_password') :
               viewMode === 'mfa' ? 'Verify Identity' :
               t('select_user')}
            </p>
          </div>
          {(viewMode === 'demo' || (viewMode === 'standard' && showPlatformLogin)) && (
            <button
              onClick={() => { setError(''); setSuccessMessage(''); setViewMode(viewMode === 'standard' ? 'demo' : 'standard'); }}
              className="mono-label border border-current px-3 py-1.5 hover:bg-[var(--color-bg-base)] hover:text-[var(--color-text-primary)]"
              style={{ color: 'inherit' }}
            >
              {viewMode === 'standard' ? t('demo_mode') : t('standard_login')}
            </button>
          )}
        </div>

        {viewMode === 'standard' && !showPlatformLogin && (
          <div className="p-8 space-y-6 bg-[var(--color-bg-surface)]">
            {error && (
              <div className="p-3 border border-[var(--color-accent-red)] text-[var(--color-accent-red)] flex items-center gap-3">
                <span className="text-lg font-bold">!</span>
                <p className="mono-label">{error}</p>
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
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => { setShowPlatformLogin(true); setError(''); setSuccessMessage(''); }}
                className="mono-label text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:underline underline-offset-4"
              >
                {t('platform_admin_login')}
              </button>
            </div>
          </div>
        )}

        {viewMode === 'standard' && showPlatformLogin && (
          <div className="p-8 space-y-6 bg-[var(--color-bg-surface)]">
            <button
              type="button"
              onClick={() => { setShowPlatformLogin(false); setError(''); setSuccessMessage(''); }}
              className="mono-label text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] flex items-center gap-1.5"
            >
              <span>←</span>
              <span>{t('back_to_sso')}</span>
            </button>
            {successMessage && (
              <div className="p-3 border border-[var(--color-accent-green)] text-[var(--color-accent-green)] flex items-center gap-3">
                <span className="text-lg font-bold">✓</span>
                <p className="mono-label">{successMessage}</p>
              </div>
            )}
            <form onSubmit={handleLocalLogin} className="space-y-5">
              {error && (
                <div className="p-3 border border-[var(--color-accent-red)] text-[var(--color-accent-red)] flex items-center gap-3">
                  <span className="text-lg font-bold">!</span>
                  <p className="mono-label">{error}</p>
                </div>
              )}
              <div>
                <label className="mono-label block mb-1.5 text-[var(--color-text-secondary)]">{t('email_label')}</label>
                <input type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); setSuccessMessage(''); }} className="input-field w-full" placeholder={t('placeholder_email')} required disabled={isLoginLoading} />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="mono-label text-[var(--color-text-secondary)]">{t('password_label')}</label>
                  <button type="button" onClick={() => { setViewMode('forgot'); setError(''); setSuccessMessage(''); }} className="mono-label text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:underline">{t('forgot_password')}</button>
                </div>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => { setPassword(e.target.value); setError(''); setSuccessMessage(''); }} className="input-field w-full pr-12" placeholder="••••••••" required disabled={isLoginLoading} />
                  <button type="button" onClick={() => setShowPassword(prev => !prev)} className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)] cursor-pointer hover:text-[var(--color-text-primary)]">
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
        )}

        {viewMode === 'forgot' && (
          <div className="p-8 space-y-6 bg-[var(--color-bg-surface)]">
            {successMessage ? (
              <div className="space-y-6 text-center py-8">
                <div className="w-16 h-16 border border-[var(--color-border-heavy)] flex items-center justify-center mx-auto text-2xl font-bold italic text-[var(--color-text-primary)]">✓</div>
                <p className="mono-label text-[var(--color-text-secondary)] leading-relaxed px-4">{successMessage}</p>
                <button onClick={() => { setViewMode('standard'); setSuccessMessage(''); }} className="mono-label text-[var(--color-text-muted)] underline underline-offset-4 hover:text-[var(--color-text-primary)]">{t('back_to_login')}</button>
              </div>
            ) : (
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
                <button type="button" onClick={() => { setViewMode('standard'); setError(''); }} className="w-full mono-label text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">{t('cancel')}</button>
              </form>
            )}
          </div>
        )}

        {viewMode === 'reset' && (
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
                  <button type="button" onMouseEnter={() => setShowPassword(true)} onMouseLeave={() => setShowPassword(false)} className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)] cursor-help hover:text-[var(--color-text-primary)]">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                </div>
              </div>
              <button type="submit" disabled={isResetLoading} className="btn-primary w-full flex items-center justify-center gap-3">
                {isResetLoading ? t('loading') : t('update_password_btn')}
              </button>
            </form>
          </div>
        )}

        {viewMode === 'mfa' && (
          <div className="p-8 space-y-6 bg-[var(--color-bg-surface)]">
            <div className="flex items-center gap-3 mb-2">
              <ShieldCheck className="h-5 w-5 text-[var(--color-text-secondary)]" />
              <span className="mono-label text-[var(--color-text-secondary)]">Two-Factor Authentication</span>
            </div>
            <form onSubmit={handleMfaVerify} className="space-y-6">
              <p className="mono-label text-[var(--color-text-secondary)] leading-relaxed">
                Enter the 6-digit code from your authenticator app, or use a recovery code.
              </p>
              {error && (
                <div className="p-3 border border-[var(--color-accent-red)] text-[var(--color-accent-red)] flex items-center gap-3">
                  <span className="text-lg font-bold">!</span>
                  <p className="mono-label">{error}</p>
                </div>
              )}
              <div>
                <label className="mono-label block mb-1.5 text-[var(--color-text-secondary)]">Verification Code</label>
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
                {isLoginLoading ? <span>{t('authenticating')}</span> : <><span>Verify</span><span>➔</span></>}
              </button>
              <button type="button" onClick={() => { setViewMode('standard'); setMfaPending(null); mfaPasswordRef.current = ''; setTotpCode(''); setError(''); }} className="w-full mono-label text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                {t('cancel')}
              </button>
            </form>
          </div>
        )}

        {viewMode === 'demo' && (
          <>
            <div className="flex border-b border-[var(--color-border-heavy)] px-4 pt-4 bg-[var(--color-bg-surface)] overflow-x-auto no-scrollbar">
              {(['all', 'platform', 'support', 'admin', 'agent'] as const).map((tab) => (
                <button key={tab} onClick={() => setFilter(tab)} className={`px-4 py-3 mono-label border-b-2 mr-1 shrink-0 ${filter === tab ? 'border-[var(--color-text-primary)] text-[var(--color-text-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'}`}>{tab === 'all' ? t('all') : tab === 'platform' ? getRoleDisplayName('platform_operator', true) : getRoleDisplayName(tab as UserRole)}</button>
              ))}
            </div>
            <div className="p-4 max-h-[30rem] overflow-y-auto bg-[var(--color-bg-surface)]">
              {error && (
                <div className="p-3 mb-3 border border-[var(--color-accent-red)] text-[var(--color-accent-red)] flex items-center gap-3">
                  <span className="text-lg font-bold">!</span>
                  <p className="mono-label">{error}</p>
                </div>
              )}
              {filtered.length === 0 && <p className="text-center mono-label text-[var(--color-text-faint)] py-16 italic">{t('no_users')}</p>}
              <ul className="space-y-2 pb-2">
                {filtered.map((u) => (
                  <li key={u.id}>
                    <button onClick={() => handleDemoLogin(u)} disabled={isDemoLoading} className="w-full text-left p-4 border border-[var(--color-border)] hover:border-[var(--color-accent-blue)] hover:bg-[var(--color-bg-elevated)] disabled:opacity-50 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 border border-[var(--color-border-heavy)] flex items-center justify-center text-lg font-bold italic text-[var(--color-text-primary)]">{u.name.charAt(0)}</div>
                        <div>
                          <p className="mono-id text-[var(--color-text-primary)]">{u.name}</p>
                          <p className="mono-label text-[var(--color-text-muted)] mt-0.5">{u.email || 'DEMO_IDENTITY'}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <span className="badge">{u.isPlatformOperator ? getRoleDisplayName('platform_operator', true) : getRoleDisplayName(u.role as UserRole)}</span>
                        <span className="mono-label text-[var(--color-text-muted)]">{(u.lang && LANG_LABEL[u.lang]) || u.lang}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </>
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

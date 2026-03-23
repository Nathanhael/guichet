import { useState, useEffect, useRef } from 'react';
import useStore from '../store/useStore';
import { useT } from '../i18n';
import type { User, Membership } from '../types';
import DarkModeToggle from '../components/DarkModeToggle';
import LanguageSwitcher from '../components/LanguageSwitcher';
import SystemBackground from '../components/SystemBackground';
import { trpc } from '../utils/trpc';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import LegalModal from '../components/LegalModal';
import { LANG_LABEL } from '../constants';
import { getRoleDisplayName } from '../utils/roles';

const DEMO_PASSWORD = 'password123';

type DemoUser = { id: string; name: string; email?: string; role?: string; lang?: string; isPlatformOperator?: boolean };

const HARDCODED_DEMO_USERS: DemoUser[] = [
  { id: 'platform_bart', name: 'Bart Operator',   email: 'bart@tessera.demo',    role: 'admin',   lang: 'nl', isPlatformOperator: true },
  { id: 'admin_dirk',    name: 'Dirk De Smedt',   email: 'dirk@tessera.demo',    role: 'admin',   lang: 'nl' },
  { id: 'expert_alex',   name: 'Alex Johnson',     email: 'alex@tessera.demo',    role: 'support', lang: 'en' },
  { id: 'expert_piet',   name: 'Piet Van Damme',   email: 'piet@tessera.demo',    role: 'support', lang: 'nl' },
  { id: 'expert_sophie', name: 'Sophie Laurent',   email: 'sophie@tessera.demo',  role: 'support', lang: 'fr' },
  { id: 'agent_jan',     name: 'Jan Peeters',      email: 'jan@tessera.demo',     role: 'agent',   lang: 'nl' },
  { id: 'agent_karim',   name: 'Karim Benali',     email: 'karim@tessera.demo',   role: 'agent',   lang: 'fr' },
  { id: 'agent_lisa',    name: 'Lisa Janssens',    email: 'lisa@tessera.demo',    role: 'agent',   lang: 'nl' },
  { id: 'agent_marie',   name: 'Marie Dubois',     email: 'marie@tessera.demo',   role: 'agent',   lang: 'fr' },
  { id: 'agent_tom',     name: 'Tom Williams',     email: 'tom@tessera.demo',     role: 'agent',   lang: 'en' },
];

type PartnerSelection = {
  token: string;
  user: User;
  memberships: Membership[];
};

export default function LoginView() {
  const { setUser, setToken, setMemberships, setActiveMembershipId } = useStore();
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
  const [resetToken, setResetToken] = useState('');
  const [legalModal, setLegalModal] = useState<'privacy' | 'terms' | null>(null);
  const [totpCode, setTotpCode] = useState('');
  // Pending MFA login credentials (stored while waiting for TOTP code)
  const [mfaPending, setMfaPending] = useState<{
    endpoint: string;
    body: Record<string, unknown>;
  } | null>(null);

  const { data: usersData } = trpc.user.demoList.useQuery(undefined, {
    enabled: viewMode === 'demo'
  });
  const users: DemoUser[] = (usersData && (usersData as DemoUser[]).length > 0)
    ? (usersData as DemoUser[])
    : HARDCODED_DEMO_USERS;

  const filtered = filter === 'all' ? users :
    filter === 'platform' ? users.filter((u: DemoUser) => u.isPlatformOperator) :
    filter === 'support' ? users.filter((u: DemoUser) => u.role === 'support') :
    filter === 'admin' ? users.filter((u: DemoUser) => u.role === 'admin') :
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
      if (ssoError === 'no_matching_groups') {
        setError(t('sso_no_groups_message'));
      } else {
        setError(decodeURIComponent(ssoError));
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Handle SSO callback from URL hash fragment
    const hash = window.location.hash;
    if (hash.startsWith('#sso_callback=')) {
      try {
        const payload = JSON.parse(decodeURIComponent(hash.slice('#sso_callback='.length)));
        const ssoMemberships = payload.memberships || [];
        if (ssoMemberships.length > 1 && !payload.user.isPlatformOperator) {
          setSelectingPartner({ token: payload.token, user: payload.user, memberships: ssoMemberships });
        } else {
          setToken(payload.token);
          setUser(payload.user);
          setMemberships(ssoMemberships);
          if (ssoMemberships.length > 0 && !payload.user.isPlatformOperator) {
            setActiveMembershipId(ssoMemberships[0].id);
          }
        }
      } catch (err) {
        console.error('[SSO] Failed to parse callback payload', err);
        setError('SSO login failed');
      }
      window.history.replaceState({}, document.title, window.location.pathname);
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
        body: JSON.stringify({ email, password, rememberMe })
      });
      const data = await res.json();
      if (res.ok) {
        if (data.mfaRequired) {
          // MFA challenge — store credentials and switch to MFA view
          setMfaPending({ endpoint: '/api/v1/auth/login-local', body: { email, password, rememberMe } });
          setViewMode('mfa');
          setTotpCode('');
          setError('');
        } else {
          setPassword('');
          const memberships = data.memberships || [];
          if (memberships.length > 1 && !data.user.isPlatformOperator) {
            setSelectingPartner({ token: data.token, user: data.user, memberships });
          } else {
            setToken(data.token);
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
        body: JSON.stringify({ ...mfaPending.body, totpCode })
      });
      const data = await res.json();
      if (res.ok) {
        setPassword('');
        setTotpCode('');
        setMfaPending(null);
        const memberships = data.memberships || [];
        if (memberships.length > 1 && !data.user.isPlatformOperator) {
          setSelectingPartner({ token: data.token, user: data.user, memberships });
        } else {
          setToken(data.token);
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
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: u.id, password: DEMO_PASSWORD })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.mfaRequired) {
          setMfaPending({ endpoint: '/api/v1/auth/login', body: { id: u.id, password: DEMO_PASSWORD } });
          setViewMode('mfa');
          setTotpCode('');
          setError('');
        } else {
          const memberships = data.memberships || [];
          if (memberships.length > 1 && !data.user.isPlatformOperator) {
            setSelectingPartner({ token: data.token, user: data.user, memberships });
          } else {
            setToken(data.token);
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
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-black dark:text-white relative bg-white dark:bg-black">
        <SystemBackground />
        <div className="w-full max-w-lg overflow-hidden relative z-10 border-2 border-black dark:border-white bg-white dark:bg-black">
          <div className="bg-black dark:bg-white px-8 py-10 text-white dark:text-black">
            <h1 className="text-2xl font-black uppercase tracking-tighter italic">{t('choose_workspace')}</h1>
            <p className="text-sm mt-2 opacity-80 font-bold uppercase tracking-widest">{selectingPartner.user.name}</p>
          </div>
          <div className="p-6 space-y-3">
            {selectingPartner.memberships.map((m) => (
              <button
                key={m.id}
                onClick={() => { setToken(selectingPartner.token); setUser(selectingPartner.user); setMemberships(selectingPartner.memberships); setActiveMembershipId(m.id); }}
                className="w-full text-left p-4 border-2 border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black flex items-center justify-between"
              >
                <div>
                  <p className="font-black uppercase tracking-tight">{m.partnerName}</p>
                  <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest">{getRoleDisplayName(m.role as any, false)} · {m.manifest?.industry}</p>
                </div>
                <span className="text-xl font-black">➔</span>
              </button>
            ))}
            <button 
              onClick={() => setSelectingPartner(null)}
              className="w-full py-3 mt-4 text-[10px] font-black uppercase tracking-widest border-2 border-transparent hover:border-black dark:hover:border-white"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 text-black dark:text-white relative bg-white dark:bg-black">
      <SystemBackground />
      <div className="absolute top-6 right-6 z-50 flex items-center gap-2 bg-black/5 dark:bg-white/5 p-1 border border-black dark:border-white">
        <LanguageSwitcher />
        <DarkModeToggle />
      </div>

      <div className="w-full max-w-lg overflow-hidden relative z-10 border-2 border-black dark:border-white bg-white dark:bg-black">
        <div className="bg-black dark:bg-white px-8 py-10 text-white dark:text-black relative overflow-hidden flex justify-between items-start">
          <div>
            <h1 className="text-5xl font-black uppercase tracking-tighter italic relative z-10">Tessera</h1>
            <p className="text-sm mt-2 opacity-80 font-bold uppercase tracking-widest relative z-10">
              {viewMode === 'standard' ? t('secure_auth') :
               viewMode === 'forgot' ? t('reset_password_title') :
               viewMode === 'reset' ? t('create_new_password') :
               viewMode === 'mfa' ? 'Verify Identity' :
               t('select_user')}
            </p>
          </div>
          {(viewMode === 'standard' || viewMode === 'demo') && (
            <button 
              onClick={() => { setError(''); setSuccessMessage(''); setViewMode(viewMode === 'standard' ? 'demo' : 'standard'); }}
              className="text-[10px] font-black uppercase tracking-widest border-2 border-current px-3 py-1.5 hover:bg-white dark:hover:bg-black hover:text-black dark:hover:text-white"
            >
              {viewMode === 'standard' ? t('demo_mode') : t('standard_login')}
            </button>
          )}
        </div>

        {viewMode === 'standard' && (
          <div className="p-8 space-y-6 bg-white dark:bg-black">
            {successMessage && (
              <div className="bg-white text-black dark:bg-black dark:text-white p-3 border-2 border-black dark:border-white flex items-center gap-3">
                <span className="text-lg font-black">✓</span>
                <p className="font-bold text-[10px] uppercase tracking-widest">{successMessage}</p>
              </div>
            )}
            <form onSubmit={handleLocalLogin} className="space-y-5">
              {error && (
                <div className="bg-black text-white dark:bg-white dark:text-black p-3 border-2 border-black dark:border-white flex items-center gap-3">
                  <span className="text-lg font-black">!</span>
                  <p className="font-bold text-[10px] uppercase tracking-widest">{error}</p>
                </div>
              )}
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5">{t('email_label')}</label>
                <input type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); setSuccessMessage(''); }} className="w-full p-4 border-2 border-black dark:border-white bg-transparent outline-none focus:ring-0 font-bold placeholder:opacity-30" placeholder={t('placeholder_email')} required disabled={isLoginLoading} />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-[10px] font-black uppercase tracking-widest">{t('password_label')}</label>
                  <button type="button" onClick={() => { setViewMode('forgot'); setError(''); setSuccessMessage(''); }} className="text-[9px] font-black uppercase tracking-widest opacity-40 hover:opacity-100 hover:underline">{t('forgot_password')}</button>
                </div>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => { setPassword(e.target.value); setError(''); setSuccessMessage(''); }} className="w-full p-4 border-2 border-black dark:border-white bg-transparent outline-none focus:ring-0 font-bold placeholder:opacity-30" placeholder="••••••••" required disabled={isLoginLoading} />
                  <button type="button" onClick={() => setShowPassword(prev => !prev)} className="absolute right-4 top-1/2 -translate-y-1/2 opacity-30 cursor-pointer hover:opacity-100">
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 py-1">
                <div className="relative flex items-center">
                  <input id="remember" type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} className="w-5 h-5 border-2 border-black dark:border-white bg-transparent appearance-none cursor-pointer checked:bg-black dark:checked:bg-white" />
                  {rememberMe && <span className="absolute inset-0 flex items-center justify-center pointer-events-none text-white dark:text-black font-black text-xs">✓</span>}
                </div>
                <label htmlFor="remember" className="text-[10px] font-black uppercase tracking-widest cursor-pointer opacity-60 select-none">{t('remember_me')}</label>
              </div>
              <button type="submit" disabled={isLoginLoading} className="w-full p-5 border-2 border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black font-black uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3">
                {isLoginLoading ? <span>{t('authenticating')}</span> : <><span>{t('login_btn')}</span><span>➔</span></>}
              </button>
            </form>
            <div className="relative flex items-center justify-center py-4">
              <div className="absolute border-t-2 border-black/10 dark:border-white/10 w-full" />
              <span className="bg-white dark:bg-black px-4 text-[9px] font-black uppercase tracking-[0.2em] opacity-30 relative z-10 italic">{t('sso_enterprise')}</span>
            </div>
            <button onClick={() => { window.location.href = '/api/v1/auth/sso/azure'; }} className="w-full p-5 border-2 border-black dark:border-white flex items-center justify-center gap-4 hover:bg-black/5 dark:hover:bg-white/5">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zm12.6 0H12.6V0H24v11.4z" /></svg>
              <span className="font-black uppercase tracking-widest">{t('sso_microsoft')}</span>
            </button>
          </div>
        )}

        {viewMode === 'forgot' && (
          <div className="p-8 space-y-6 bg-white dark:bg-black">
            {successMessage ? (
              <div className="space-y-6 text-center py-8">
                <div className="w-16 h-16 border-4 border-black dark:border-white flex items-center justify-center mx-auto text-2xl font-black italic">✓</div>
                <p className="font-bold text-xs uppercase tracking-widest leading-relaxed px-4">{successMessage}</p>
                <button onClick={() => { setViewMode('standard'); setSuccessMessage(''); }} className="text-[10px] font-black uppercase tracking-widest underline underline-offset-4 hover:opacity-60">{t('back_to_login')}</button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-6">
                <p className="text-[10px] font-bold uppercase opacity-60 tracking-tight leading-relaxed">{t('reset_password_desc')}</p>
                {error && <div className="bg-black text-white dark:bg-white dark:text-black p-3 border-2 border-black dark:border-white flex items-center gap-3"><span className="text-lg font-black">!</span><p className="font-bold text-[10px] uppercase tracking-widest">{error}</p></div>}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5">{t('email_label')}</label>
                  <input type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }} className="w-full p-4 border-2 border-black dark:border-white bg-transparent outline-none focus:ring-0 font-bold" placeholder={t('placeholder_email')} required disabled={isForgotLoading} />
                </div>
                <button type="submit" disabled={isForgotLoading} className="w-full p-5 border-2 border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black font-black uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-3">
                  {isForgotLoading ? t('loading') : t('send_reset_link')}
                </button>
                <button type="button" onClick={() => { setViewMode('standard'); setError(''); }} className="w-full text-[10px] font-black uppercase tracking-widest opacity-40 hover:opacity-100">{t('cancel')}</button>
              </form>
            )}
          </div>
        )}

        {viewMode === 'reset' && (
          <div className="p-8 space-y-6 bg-white dark:bg-black">
            <form onSubmit={handleResetPassword} className="space-y-6">
              <p className="text-[10px] font-bold uppercase opacity-60 tracking-tight leading-relaxed">{t('new_password_desc')}</p>
              {error && <div className="bg-black text-white dark:bg-white dark:text-black p-3 border-2 border-black dark:border-white flex items-center gap-3"><span className="text-lg font-black">!</span><p className="font-bold text-[10px] uppercase tracking-widest">{error}</p></div>}
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5">{t('password_label')}</label>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} className="w-full p-4 border-2 border-black dark:border-white bg-transparent outline-none focus:ring-0 font-bold" placeholder="••••••••" required disabled={isResetLoading} />
                  <button type="button" onMouseEnter={() => setShowPassword(true)} onMouseLeave={() => setShowPassword(false)} className="absolute right-4 top-1/2 -translate-y-1/2 opacity-30 cursor-help">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                </div>
              </div>
              <button type="submit" disabled={isResetLoading} className="w-full p-5 border-2 border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black font-black uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-3">
                {isResetLoading ? t('loading') : t('update_password_btn')}
              </button>
            </form>
          </div>
        )}

        {viewMode === 'mfa' && (
          <div className="p-8 space-y-6 bg-white dark:bg-black">
            <div className="flex items-center gap-3 mb-2">
              <ShieldCheck className="h-5 w-5" />
              <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Two-Factor Authentication</span>
            </div>
            <form onSubmit={handleMfaVerify} className="space-y-6">
              <p className="text-[10px] font-bold uppercase opacity-60 tracking-tight leading-relaxed">
                Enter the 6-digit code from your authenticator app, or use a recovery code.
              </p>
              {error && (
                <div className="bg-black text-white dark:bg-white dark:text-black p-3 border-2 border-black dark:border-white flex items-center gap-3">
                  <span className="text-lg font-black">!</span>
                  <p className="font-bold text-[10px] uppercase tracking-widest">{error}</p>
                </div>
              )}
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5">Verification Code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totpCode}
                  onChange={e => { setTotpCode(e.target.value); setError(''); }}
                  className="w-full p-4 border-2 border-black dark:border-white bg-transparent outline-none focus:ring-0 font-mono text-center text-lg tracking-[0.3em]"
                  placeholder="000000"
                  required
                  disabled={isLoginLoading}
                  autoFocus
                />
              </div>
              <button type="submit" disabled={isLoginLoading || totpCode.trim().length < 6} className="w-full p-5 border-2 border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black font-black uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-3">
                {isLoginLoading ? <span>{t('authenticating')}</span> : <><span>Verify</span><span>➔</span></>}
              </button>
              <button type="button" onClick={() => { setViewMode('standard'); setMfaPending(null); setTotpCode(''); setError(''); }} className="w-full text-[10px] font-black uppercase tracking-widest opacity-40 hover:opacity-100">
                {t('cancel')}
              </button>
            </form>
          </div>
        )}

        {viewMode === 'demo' && (
          <>
            <div className="flex border-b-2 border-black dark:border-white px-4 pt-4 bg-white dark:bg-black overflow-x-auto no-scrollbar">
              {(['all', 'platform', 'support', 'admin', 'agent'] as const).map((tab) => (
                <button key={tab} onClick={() => setFilter(tab)} className={`px-4 py-3 text-xs font-black uppercase tracking-wider border-b-4 mr-1 shrink-0 ${filter === tab ? 'border-black dark:border-white text-black dark:text-white' : 'border-transparent opacity-30 hover:opacity-100'}`}>{tab === 'all' ? t('all') : tab === 'platform' ? getRoleDisplayName('platform_operator', true) : getRoleDisplayName(tab as any)}</button>
              ))}
            </div>
            <div className="p-4 max-h-[30rem] overflow-y-auto bg-white dark:bg-black">
              {error && (
                <div className="bg-black text-white dark:bg-white dark:text-black p-3 mb-3 border-2 border-black dark:border-white flex items-center gap-3">
                  <span className="text-lg font-black">!</span>
                  <p className="font-bold text-[10px] uppercase tracking-widest">{error}</p>
                </div>
              )}
              {filtered.length === 0 && <p className="text-center opacity-30 py-16 font-black uppercase tracking-widest italic">{t('no_users')}</p>}
              <ul className="space-y-3 pb-2">
                {filtered.map((u) => (
                  <li key={u.id}>
                    <button onClick={() => handleDemoLogin(u)} disabled={isDemoLoading} className="w-full text-left p-4 border-2 border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black disabled:opacity-50 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 border-2 border-current flex items-center justify-center text-xl font-black italic">{u.name.charAt(0)}</div>
                        <div>
                          <p className="font-black uppercase tracking-tight text-lg">{u.name}</p>
                          <p className="text-[9px] font-bold opacity-40 uppercase tracking-widest">{u.email || 'DEMO_IDENTITY'}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <span className="text-[9px] font-black uppercase tracking-widest border-2 border-current px-2 py-0.5 italic">{u.isPlatformOperator ? getRoleDisplayName('platform_operator', true) : getRoleDisplayName(u.role as any)}</span>
                        <span className="text-[10px] font-bold opacity-60">{(u.lang && LANG_LABEL[u.lang]) || u.lang}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>

      <div className="mt-12 flex gap-8 opacity-30 hover:opacity-100">
        <button onClick={() => setLegalModal('privacy')} className="text-[9px] font-black uppercase tracking-widest hover:underline">{t('privacy_policy')}</button>
        <button onClick={() => setLegalModal('terms')} className="text-[9px] font-black uppercase tracking-widest hover:underline">{t('terms_of_service')}</button>
      </div>
      {legalModal && <LegalModal type={legalModal} onClose={() => setLegalModal(null)} />}
    </div>
  );
}

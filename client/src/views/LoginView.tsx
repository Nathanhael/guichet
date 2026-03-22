import { useState, useEffect } from 'react';
import useStore from '../store/useStore';
import { tBrowser, useT } from '../i18n';
import DarkModeToggle from '../components/DarkModeToggle';
import LanguageSwitcher from '../components/LanguageSwitcher';
import SystemBackground from '../components/SystemBackground';
import { trpc } from '../utils/trpc';
import { Eye, EyeOff } from 'lucide-react';
import LegalModal from '../components/LegalModal';

const LANG_FLAG: Record<string, string> = { nl: '🇧🇪 NL', fr: '🇫🇷 FR', en: '🇬🇧 EN' };

const DEMO_PASSWORD = 'password123';

type DemoUser = { id: string; name: string; email?: string; role?: string; lang?: string; isPlatformOperator?: boolean };

type PartnerSelection = {
  user: { id: string; name: string; email?: string; isPlatformOperator?: boolean };
  memberships: { id: string; partnerId: string; partnerName: string; role: string; manifest?: { industry?: string } }[];
};

export default function LoginView() {
  const { setUser, setToken, setMemberships, setActiveMembershipId } = useStore();
  const t = useT();
  const [filter, setFilter] = useState<'all' | 'platform' | 'support' | 'admin' | 'agent'>('all');
  const [selectingPartner, setSelectingPartner] = useState<PartnerSelection | null>(null);
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [viewMode, setViewMode] = useState<'standard' | 'demo' | 'forgot' | 'reset'>('standard');
  const [resetToken, setResetToken] = useState('');
  const [legalModal, setLegalModal] = useState<'privacy' | 'terms' | null>(null);

  const { data: usersData, isLoading: loading } = trpc.user.list.useQuery(undefined, {
    enabled: viewMode === 'demo'
  });
  const users = (usersData || []) as DemoUser[];

  const ROLE_LABEL: Record<string, string> = { 
    agent: t('agent'),
    support: t('support'),
    admin: t('admin'),
    platform_operator: t('platform_operator')
  };

  const filtered = filter === 'all' ? users :
    filter === 'platform' ? users.filter((u: DemoUser) => u.isPlatformOperator) :
    filter === 'support' ? users.filter((u: DemoUser) => u.role === 'support') :
    filter === 'admin' ? users.filter((u: DemoUser) => u.role === 'admin') :
    filter === 'agent' ? users.filter((u: DemoUser) => u.role === 'agent') :
    users;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      setResetToken(token);
      setViewMode('reset');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;
    setError('');
    setIsLoggingIn(true);
    try {
      const res = await fetch('/api/v1/auth/login-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, rememberMe })
      });
      const data = await res.json();
      if (res.ok) {
        const memberships = data.memberships || [];
        if (memberships.length > 1 && !data.user.isPlatformOperator) {
          setUser(data.user);
          setToken(data.token);
          setMemberships(memberships);
          setSelectingPartner({ user: data.user, memberships });
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
      setIsLoggingIn(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;
    setError('');
    setIsLoggingIn(true);
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
      setIsLoggingIn(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;
    setError('');
    setIsLoggingIn(true);
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
      setIsLoggingIn(false);
    }
  };

  const handleDemoLogin = async (u: DemoUser) => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: u.id, password: DEMO_PASSWORD })
      });
      if (res.ok) {
        const data = await res.json();
        const memberships = data.memberships || [];
        if (memberships.length > 1 && !data.user.isPlatformOperator) {
          setUser(data.user);
          setToken(data.token);
          setMemberships(memberships);
          setSelectingPartner({ user: data.user, memberships });
        } else {
          setToken(data.token);
          setUser(data.user);
          setMemberships(memberships);
          if (memberships.length > 0 && !data.user.isPlatformOperator) {
            setActiveMembershipId(memberships[0].id);
          }
        }
      } else {
         const errData = await res.json();
         setError(errData.error || t('login_failed'));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoggingIn(false);
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
                onClick={() => setActiveMembershipId(m.id)}
                className="w-full text-left p-4 border-2 border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black flex items-center justify-between"
              >
                <div>
                  <p className="font-black uppercase tracking-tight">{m.partnerName}</p>
                  <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest">{ROLE_LABEL[m.role] || m.role} · {m.manifest?.industry}</p>
                </div>
                <span className="text-xl font-black">➔</span>
              </button>
            ))}
            <button 
              onClick={() => { setUser(null); setToken(null); setSelectingPartner(null); }}
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
                <input type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); setSuccessMessage(''); }} className="w-full p-4 border-2 border-black dark:border-white bg-transparent outline-none focus:ring-0 font-bold placeholder:opacity-30" placeholder={t('placeholder_email')} required disabled={isLoggingIn} />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-[10px] font-black uppercase tracking-widest">{t('password_label')}</label>
                  <button type="button" onClick={() => { setViewMode('forgot'); setError(''); setSuccessMessage(''); }} className="text-[9px] font-black uppercase tracking-widest opacity-40 hover:opacity-100 hover:underline">{t('forgot_password')}</button>
                </div>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => { setPassword(e.target.value); setError(''); setSuccessMessage(''); }} className="w-full p-4 border-2 border-black dark:border-white bg-transparent outline-none focus:ring-0 font-bold placeholder:opacity-30" placeholder="••••••••" required disabled={isLoggingIn} />
                  <button type="button" onMouseEnter={() => setShowPassword(true)} onMouseLeave={() => setShowPassword(false)} className="absolute right-4 top-1/2 -translate-y-1/2 opacity-30 cursor-help hover:opacity-100">
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
              <button type="submit" disabled={isLoggingIn} className="w-full p-5 border-2 border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black font-black uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3">
                {isLoggingIn ? <span>{t('authenticating')}</span> : <><span>{t('login_btn')}</span><span>➔</span></>}
              </button>
            </form>
            <div className="relative flex items-center justify-center py-4">
              <div className="absolute border-t-2 border-black/10 dark:border-white/10 w-full" />
              <span className="bg-white dark:bg-black px-4 text-[9px] font-black uppercase tracking-[0.2em] opacity-30 relative z-10 italic">{t('sso_enterprise')}</span>
            </div>
            <button onClick={() => setSuccessMessage(t('sso_coming_soon'))} className="w-full p-5 border-2 border-black dark:border-white flex items-center justify-center gap-4 hover:bg-black/5 dark:hover:bg-white/5">
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
                  <input type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }} className="w-full p-4 border-2 border-black dark:border-white bg-transparent outline-none focus:ring-0 font-bold" placeholder={t('placeholder_email')} required disabled={isLoggingIn} />
                </div>
                <button type="submit" disabled={isLoggingIn} className="w-full p-5 border-2 border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black font-black uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-3">
                  {isLoggingIn ? t('loading') : t('send_reset_link')}
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
                  <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} className="w-full p-4 border-2 border-black dark:border-white bg-transparent outline-none focus:ring-0 font-bold" placeholder="••••••••" required disabled={isLoggingIn} />
                  <button type="button" onMouseEnter={() => setShowPassword(true)} onMouseLeave={() => setShowPassword(false)} className="absolute right-4 top-1/2 -translate-y-1/2 opacity-30 cursor-help">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                </div>
              </div>
              <button type="submit" disabled={isLoggingIn} className="w-full p-5 border-2 border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black font-black uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-3">
                {isLoggingIn ? t('loading') : t('update_password_btn')}
              </button>
            </form>
          </div>
        )}

        {viewMode === 'demo' && (
          <>
            <div className="flex border-b-2 border-black dark:border-white px-4 pt-4 bg-white dark:bg-black overflow-x-auto no-scrollbar">
              {(['all', 'platform', 'support', 'admin', 'agent'] as const).map((tab) => (
                <button key={tab} onClick={() => setFilter(tab)} className={`px-4 py-3 text-xs font-black uppercase tracking-wider border-b-4 mr-1 shrink-0 ${filter === tab ? 'border-black dark:border-white text-black dark:text-white' : 'border-transparent opacity-30 hover:opacity-100'}`}>{tab === 'all' ? t('all') : ROLE_LABEL[tab] || tab}</button>
              ))}
            </div>
            <div className="p-4 max-h-[30rem] overflow-y-auto bg-white dark:bg-black">
              {loading && <div className="flex flex-col items-center justify-center py-16 gap-4"><p className="text-[10px] font-black uppercase tracking-widest italic">{t('loading')}</p></div>}
              {!loading && filtered.length === 0 && <p className="text-center opacity-30 py-16 font-black uppercase tracking-widest italic">{t('no_users')}</p>}
              <ul className="space-y-3 pb-2">
                {filtered.map((u) => (
                  <li key={u.id}>
                    <button onClick={() => handleDemoLogin(u)} disabled={isLoggingIn} className="w-full text-left p-4 border-2 border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 border-2 border-current flex items-center justify-center text-xl font-black italic">{u.name.charAt(0)}</div>
                        <div>
                          <p className="font-black uppercase tracking-tight text-lg">{u.name}</p>
                          <p className="text-[9px] font-bold opacity-40 uppercase tracking-widest">{u.email || 'DEMO_IDENTITY'}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <span className="text-[9px] font-black uppercase tracking-widest border-2 border-current px-2 py-0.5 italic">{ROLE_LABEL[u.role] || u.role}</span>
                        <span className="text-[10px] font-bold opacity-60">{LANG_FLAG[u.lang] || u.lang}</span>
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

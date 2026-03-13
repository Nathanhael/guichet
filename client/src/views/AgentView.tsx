import { useEffect, useRef, useState } from 'react';
import useStore from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { useT } from '../i18n';
import BusinessHoursGuard from '../components/BusinessHoursGuard';
import ChatWindow from '../components/ChatWindow';
import DarkModeToggle from '../components/DarkModeToggle';
import RatingModal from '../components/RatingModal';
import FeedbackModal from '../components/FeedbackModal';
import NeuroToggle from '../components/NeuroToggle';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { requestNotificationPermission } from '../utils/notifications';
import { trpc } from '../utils/trpc';


export default function AgentView() {
  const { user, tickets, setTickets, activeTicketId, setActiveTicketId, logout, notificationsEnabled, setNotificationsEnabled } = useStore();
  const t = useT();
  const [form, setForm] = useState({ dept: 'DSC', refValue: '' });
  const [submitting, setSubmitting] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const pendingNavigate = useRef(false);

  // tRPC Ticket List
  const { data: ticketList, isLoading } = trpc.ticket.list.useQuery(
    { agentId: user?.id },
    { 
      enabled: !!user?.id,
      onSuccess: (data) => setTickets(data as any),
    }
  );

  useEffect(() => {
    if (notificationsEnabled) {
      requestNotificationPermission();
    }
  }, [notificationsEnabled]);

  const myTickets = tickets.filter((tk) => user && tk.agentId === user.id);
  const activeTicket = myTickets.find((tk) => tk.id === activeTicketId);

  useEffect(() => {
    if (!pendingNavigate.current || myTickets.length === 0) return;
    const newest = [...myTickets].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    setActiveTicketId(newest.id);
    setSubmitting(false);
    pendingNavigate.current = false;
  }, [myTickets.length, setActiveTicketId, myTickets]);

  const submitTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    pendingNavigate.current = true;

    getSocket().emit('ticket:new', {
      dept: form.dept,
      agentId: user.id,
      agentLang: user.lang,
      cdbId: form.dept === 'DSC' ? form.refValue.trim() : null,
      dareRef: form.dept === 'FOT' ? form.refValue.trim() : null,
      text: '',
      mediaUrl: null,
    });

    setForm({ dept: 'DSC', refValue: '' });
  };

  if (!user) return null;

  return (
    <BusinessHoursGuard>
    <div className="h-screen flex flex-col overflow-hidden bg-transparent animate-fade-in">
        <nav className="bg-brand-900/95 backdrop-blur-md text-white px-6 py-3 flex items-center justify-between shadow-lg sticky top-0 z-50 border-b border-brand-800">
          <div className="flex items-center gap-3">
            <span className="font-bold text-xl tracking-tight">M&P Support</span>
            <span className="text-xs bg-gradient-to-r from-accent-500 to-rose-500 px-2.5 py-1 rounded-md font-semibold tracking-wide shadow-sm">Agent</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-solarized-base1">{user.name} · {user.lang.toUpperCase()}</span>
            {activeTicket && (
              <button
                onClick={() => setActiveTicketId(null)}
                className="btn-primary"
              >
                {t('new_ticket')}
              </button>
            )}
            
            <div className="flex items-center gap-2 bg-black/10 dark:bg-white/5 p-1 rounded-xl border border-white/10 ml-2">
              <LanguageSwitcher />
              <NeuroToggle />
              <DarkModeToggle />
              
              <button
                onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                title={notificationsEnabled ? 'Disable notifications' : 'Enable notifications'}
                className={`p-2 rounded-lg flex items-center justify-center transition-all duration-300 ${
                  notificationsEnabled 
                    ? 'text-accent-400 bg-white/10 shadow-sm' 
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                }`}
              >
                {notificationsEnabled ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                )}
              </button>
            </div>

            <button
              onClick={() => setShowFeedback(true)}
              className="text-solarized-base1 hover:text-white text-sm flex items-center gap-1.5 ml-2 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
              title={t('feedback')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
              {t('feedback')}
            </button>
            <button onClick={logout} className="text-solarized-base1 hover:text-rose-400 text-sm font-medium ml-2 transition-colors">{t('sign_out')}</button>
          </div>
        </nav>

        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTicket ? (
            <div className="flex-1 min-h-0 w-full animate-fade-in">
              <div className="h-full flex flex-col overflow-hidden bg-white/50 backdrop-blur-md dark:bg-brand-900/40">
                <ChatWindow key={activeTicket.id} ticket={activeTicket} onClose={() => setActiveTicketId(null)} />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-6">
              {isLoading && !tickets.length ? (
                <div className="text-solarized-base1 animate-pulse">Loading your tickets...</div>
              ) : (
                <div className="glass-panel p-10 w-full max-w-lg animate-slide-up border border-white/20 dark:border-brand-700/50 bg-white/70 dark:bg-brand-900/40 backdrop-blur-xl rounded-3xl shadow-2xl">
                  <h2 className="text-2xl font-bold text-solarized-base01 dark:text-white mb-2">
                    {t('hello')}, <span className="text-accent-500">{user.name.split(' ')[1] || user.name}</span>
                  </h2>
                  <p className="text-sm text-solarized-base00 dark:text-slate-400 mb-8 font-medium">{t('choose_dept_desc')}</p>

                  <form onSubmit={submitTicket} className="space-y-4">
                    <div className="flex gap-3">
                      {['DSC', 'FOT'].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, dept: d }))}
                          className={`flex-1 py-4 rounded-xl border-2 text-sm font-semibold transition-all duration-300 hover:-translate-y-1 ${form.dept === d
                            ? d === 'DSC'
                              ? 'border-amber-500 bg-gradient-to-b from-amber-50/50 to-solarized-base3 dark:from-amber-900/30 dark:to-brand-800 text-amber-600 dark:text-amber-400 shadow-md'
                              : 'border-indigo-500 bg-gradient-to-b from-indigo-50/50 to-solarized-base3 dark:from-indigo-900/30 dark:to-brand-800 text-indigo-600 dark:text-indigo-400 shadow-md'
                            : 'border-solarized-base2 dark:border-brand-700 bg-solarized-base3/50 dark:bg-brand-800/50 text-solarized-base01 dark:text-slate-400 hover:border-accent-300 dark:hover:border-accent-500 hover:shadow-sm'
                            }`}
                        >
                          <span className="block text-lg font-bold tracking-tight">{d}</span>
                          <span className="block text-xs font-medium opacity-80 mt-1">
                            {d === 'DSC' ? 'Billing & Sales' : t('technical')}
                          </span>
                        </button>
                      ))}
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-solarized-base01 dark:text-gray-300 mb-2">
                        {form.dept === 'FOT' ? 'Dare Ref' : 'CDBID'}{' '}
                        <span className="text-solarized-base1 font-normal">(optional)</span>
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={form.refValue}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/[^0-9]/g, '');
                          setForm((f) => ({ ...f, refValue: digits.slice(0, 15) }));
                        }}
                        placeholder={form.dept === 'FOT' ? 'e.g. 1234567890' : 'e.g. 123456'}
                        className="input-field"
                      />
                    </div>

                    <div className="pt-2">
                      <button
                        type="submit"
                        disabled={submitting}
                        className="btn-primary w-full py-3.5 text-base shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
                      >
                        {submitting ? t('connecting') : t('connect_with_expert')}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <RatingModal />
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </BusinessHoursGuard>
  );
}

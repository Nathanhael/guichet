import { useEffect, useState } from 'react';
import useStore from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { useBusinessHours } from '../hooks/useBusinessHours';
import { useT } from '../i18n';
import ChatWindow from '../components/ChatWindow';
import SystemBackground from '../components/SystemBackground';
import DarkModeToggle from '../components/DarkModeToggle';
import LanguageSwitcher from '../components/LanguageSwitcher';
import BusinessHoursGuard from '../components/BusinessHoursGuard';
import FeedbackModal from '../components/FeedbackModal';
import RatingModal from '../components/RatingModal';
import PartnerUnavailable from '../components/PartnerUnavailable';
import { trpc } from '../utils/trpc';
export default function AgentView() {
  const { user, logout, tickets, setTickets, activeTicketId, setActiveTicketId, focusMode, memberships, activeMembershipId } = useStore();
  const activeMembership = (memberships || []).find(m => m.id === activeMembershipId);
  const manifest = activeMembership?.manifest || {
    industry: 'general',
    ref1Label: 'Reference 1',
    ref2Label: 'Reference 2',
    departments: []
  };
  const t = useT();
  const [dept, setDept] = useState(manifest.departments[0]?.id || 'DSC');
  const [ref1, setRef1] = useState('');
  const [ref2, setRef2] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const notificationsEnabled = useStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useStore((s) => s.setNotificationsEnabled);
  const { status: businessHoursStatus } = useBusinessHours();

  useEffect(() => {
    const nextDept = manifest.departments[0]?.id || 'DSC';
    const hasSelectedDept = manifest.departments.some((department) => department.id === dept);

    if (!hasSelectedDept) {
      setDept(nextDept);
    }
  }, [manifest.departments, dept]);

  // tRPC Ticket List
  const { data: ticketList } = trpc.ticket.list.useQuery(
    { agentId: user?.id },
    { 
      enabled: !!user?.id,
    }
  );

  useEffect(() => {
    if (ticketList) {
      setTickets(ticketList as any);
    }
  }, [ticketList, setTickets]);

  useEffect(() => {
    const s = getSocket();
    const onCreated = () => {
      setRef1('');
      setRef2('');
      setText('');
      setLoading(false);
    };
    const onError = () => {
      setLoading(false);
    };
    s.on('ticket:created:self', onCreated);
    s.on('error', onError);
    s.on('hours:closed', onError);
    return () => {
      s.off('ticket:created:self', onCreated);
      s.off('error', onError);
      s.off('hours:closed', onError);
    };
  }, []);

  const activeTicket = tickets.find((tk) => tk.id === activeTicketId);
  const canCreateTicket = businessHoursStatus?.isOpen ?? true;

  async function createTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !text.trim() || !canCreateTicket) return;
    setLoading(true);
    getSocket().emit('ticket:new', {
      dept,
      agentId: user.id,
      agentLang: user.lang,
      ref1,
      ref2,
      text: text.trim(),
    });
  }

  if (!user) return null;

  // Guard: partner was deleted — activeMembership is undefined
  if (!activeMembership) return <PartnerUnavailable />;

  return (
    <BusinessHoursGuard mode={activeTicket ? 'notice' : 'block'}>
      <div className={`h-full bg-transparent flex flex-col overflow-hidden relative transition-all duration-700 ${focusMode ? 'zen-mode' : ''}`}>
        <SystemBackground />
        
        <nav className="relative z-50 px-6 py-3 bg-brand-900/95 backdrop-blur-md border-b border-brand-800 text-white flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            {manifest.logoUrl ? (
              <img src={manifest.logoUrl} alt={activeMembership?.partnerName || 'Partner'} className="h-8 object-contain" />
            ) : (
              <span className="text-xl font-bold tracking-tight">{manifest.industry} Support</span>
            )}
            <span className="text-xs px-2.5 py-1 rounded-md bg-brand-800 border border-brand-700 font-semibold tracking-wide">Agent</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-ui-base2">{user.name}</span>
            
            <div className="flex items-center gap-2 bg-black/5 dark:bg-white/5 p-1 border border-black dark:border-white ml-2">
              <LanguageSwitcher />
              <DarkModeToggle />
              
              <button
                onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                title={notificationsEnabled ? 'Disable notifications' : 'Enable notifications'}
                aria-label={notificationsEnabled ? t('mute_notifications') : t('enable_notifications')}
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
              className="text-ui-base1 hover:text-white text-sm flex items-center gap-1.5 ml-2 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
              title={t('feedback')}
              aria-label={t('feedback')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
              {t('feedback')}
            </button>
            <button onClick={logout} aria-label={t('sign_out')} className="text-ui-base1 hover:text-rose-400 text-sm font-medium ml-2 transition-colors">{t('sign_out')}</button>
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
            <div className="flex-1 flex flex-col items-center justify-center p-6">
              {!loading && canCreateTicket && (
                <div className="w-full max-w-lg border-2 border-black dark:border-white p-8">
                  <h2 className="text-2xl font-black uppercase tracking-tight mb-2">{t('hello')}, {user.name}</h2>
                  <p className="text-sm opacity-60 mb-8">{t('choose_dept_desc')}</p>
                  
                  <form onSubmit={createTicket} aria-label={t('new_ticket')} className="space-y-6">
                    <div className="grid grid-cols-2 gap-3">
                      {manifest.departments.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => setDept(d.id)}
                          className={`py-3 px-4 border-2 font-black text-sm uppercase tracking-widest ${
                            dept === d.id
                              ? 'border-black dark:border-white bg-black dark:bg-white text-white dark:text-black'
                              : 'border-black/30 dark:border-white/30 hover:border-black dark:hover:border-white'
                          }`}
                        >
                          {d.name}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] uppercase font-black tracking-widest opacity-60">{manifest.ref1Label}</label>
                          <input
                            type="text"
                            value={ref1}
                            onChange={(e) => setRef1(e.target.value)}
                            placeholder={t('dare_placeholder')}
                            className="w-full border-2 border-black dark:border-white px-4 py-2.5 text-sm bg-transparent outline-none"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] uppercase font-black tracking-widest opacity-60">{manifest.ref2Label} <span className="text-[8px] opacity-50">({t('optional')})</span></label>
                          <input
                            type="text"
                            value={ref2}
                            onChange={(e) => setRef2(e.target.value)}
                            placeholder={t('case_placeholder')}
                            className="w-full border-2 border-black dark:border-white px-4 py-2.5 text-sm bg-transparent outline-none"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-black tracking-widest opacity-60">{t('question_problem')}</label>
                        <textarea
                          rows={4}
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          placeholder={t('describe_problem')}
                          required
                          className="w-full border-2 border-black dark:border-white px-4 py-3 text-sm bg-transparent outline-none resize-none"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={loading || !text.trim()}
                      className="w-full border-2 border-black dark:border-white bg-black dark:bg-white text-white dark:text-black py-4 font-black uppercase tracking-widest text-sm disabled:opacity-30"
                    >
                      {loading ? t('connecting') : t('connect_with_support')}
                    </button>
                  </form>
                </div>
              )}

              {loading && (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 border-4 border-black dark:border-white border-t-transparent" />
                  <p className="text-sm opacity-60 mt-1 font-black uppercase tracking-widest">{t('waiting_for_support')}</p>
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

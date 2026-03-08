import React, { useEffect, useRef, useState } from 'react';
import useStore from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { useT } from '../i18n';
import BusinessHoursGuard from '../components/BusinessHoursGuard';
import ChatWindow from '../components/ChatWindow';
import DarkModeToggle from '../components/DarkModeToggle';
import RatingModal from '../components/RatingModal';
import FeedbackModal from '../components/FeedbackModal';

export default function AgentView() {
  const { user, tickets, setTickets, activeTicketId, setActiveTicketId, logout } = useStore();
  const t = useT();
  const [form, setForm] = useState({ dept: 'DSC', refValue: '' });
  const [submitting, setSubmitting] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const pendingNavigate = useRef(false);

  useEffect(() => {
    fetch(`/api/tickets?agentId=${user.id}`)
      .then((r) => r.json())
      .then((data) => setTickets(data))
      .catch(console.error);
  }, [user.id]);

  const myTickets = tickets.filter((t) => t.agentId === user.id);
  const activeTicket = myTickets.find((t) => t.id === activeTicketId);

  useEffect(() => {
    if (!pendingNavigate.current || myTickets.length === 0) return;
    const newest = [...myTickets].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    setActiveTicketId(newest.id);
    setSubmitting(false);
    pendingNavigate.current = false;
  }, [myTickets.length]);

  function submitTicket(e) {
    e.preventDefault();
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
  }

  return (
    <BusinessHoursGuard>
      <div className="h-screen flex flex-col overflow-hidden bg-transparent animate-fade-in">
        <nav className="bg-brand-900/95 backdrop-blur-md text-white px-6 py-3 flex items-center justify-between shadow-lg sticky top-0 z-50 border-b border-brand-800">
          <div className="flex items-center gap-3">
            <span className="font-bold text-xl tracking-tight">iKanbi</span>
            <span className="text-xs bg-gradient-to-r from-accent-500 to-rose-500 px-2.5 py-1 rounded-md font-semibold tracking-wide shadow-sm">Agent</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">{user.name} · {user.lang.toUpperCase()}</span>
            {activeTicket && (
              <button
                onClick={() => setActiveTicketId(null)}
                className="btn-primary"
              >
                {t('new_ticket')}
              </button>
            )}
            <button
              onClick={() => setShowFeedback(true)}
              className="text-gray-400 hover:text-white text-sm flex items-center gap-1"
              title={t('feedback')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
              {t('feedback')}
            </button>
            <DarkModeToggle />
            <button onClick={logout} className="text-gray-400 hover:text-white text-sm">{t('sign_out')}</button>
          </div>
        </nav>

        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTicket ? (
            <div className="flex-1 px-4 py-4 min-h-0 animate-fade-in w-full max-w-5xl mx-auto">
              <div className="glass-card h-full flex flex-col overflow-hidden shadow-2xl">
                <ChatWindow ticket={activeTicket} onClose={() => setActiveTicketId(null)} />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="glass-card p-10 w-full max-w-lg animate-slide-up">
                <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">
                  {t('hello')}, <span className="text-accent-500">{user.name.split(' ')[1] || user.name}</span>
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-8 font-medium">{t('choose_dept_desc')}</p>

                <form onSubmit={submitTicket} className="space-y-4">
                  <div className="flex gap-3">
                    {['DSC', 'FOT'].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, dept: d }))}
                        className={`flex-1 py-4 rounded-xl border-2 text-sm font-semibold transition-all duration-300 hover:-translate-y-1 ${form.dept === d
                          ? 'border-accent-500 bg-gradient-to-b from-accent-50/50 to-white dark:from-accent-900/30 dark:to-brand-800 text-accent-600 dark:text-accent-400 shadow-md'
                          : 'border-white/40 dark:border-brand-700 bg-white/50 dark:bg-brand-800/50 text-slate-500 dark:text-slate-400 hover:border-accent-300 dark:hover:border-accent-500 hover:shadow-sm'
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
                    <label className="block text-sm font-semibold text-slate-700 dark:text-gray-300 mb-2">
                      {form.dept === 'FOT' ? 'Dare Ref' : 'CDBID'}{' '}
                      <span className="text-slate-400 font-normal">(optional)</span>
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
            </div>
          )}
        </div>
      </div>
      <RatingModal />
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </BusinessHoursGuard>
  );
}

import { useEffect, useState } from 'react';
import useStore from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { usePartner } from '../hooks/usePartner';
import { useT } from '../i18n';
import ChatWindow from '../components/ChatWindow';
import { trpc } from '../utils/trpc';
import type { Ticket } from '../types';

export default function AgentLiteView() {
  const user = useStore((s) => s.user);
  const logout = useStore((s) => s.logout);
  const tickets = useStore((s) => s.tickets);
  const setTickets = useStore((s) => s.setTickets);
  const activeTicketId = useStore((s) => s.activeTicketId);
  const setActiveTicketId = useStore((s) => s.setActiveTicketId);
  const { manifest } = usePartner();
  const t = useT();

  const [dept, setDept] = useState(manifest.departments?.[0]?.id || 'DSC');
  const [ref1, setRef1] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'list' | 'create' | 'chat'>('list');

  const { data: ticketList } = trpc.ticket.list.useQuery(
    { agentId: user?.id },
    { enabled: !!user?.id }
  );

  useEffect(() => {
    if (ticketList) setTickets(ticketList as Ticket[]);
  }, [ticketList, setTickets]);

  useEffect(() => {
    if (activeTicketId) setView('chat');
  }, [activeTicketId]);

  const activeTicket = tickets.find((tk) => tk.id === activeTicketId);

  function createTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !text.trim()) return;
    setLoading(true);
    getSocket().emit('ticket:new', {
      dept,
      agentId: user.id,
      agentLang: user.lang,
      ref1,
      ref2: '',
      text: text.trim(),
    });
    setRef1('');
    setText('');
    setLoading(false);
    setView('list');
  }

  if (!user) return null;

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-950">
      {/* Minimal header */}
      <header className="flex items-center justify-between px-4 py-3 bg-brand-900 text-white" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="flex items-center gap-2">
          {view !== 'list' && (
            <button
              onClick={() => { setView('list'); setActiveTicketId(null); }}
              className="p-2 -ml-2 rounded-lg active:bg-white/10"
              aria-label={t('back')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <span className="font-bold text-lg">{manifest.industry || 'Tessera'}</span>
        </div>
        <button
          onClick={logout}
          className="text-sm text-gray-300 active:text-white px-3 py-2"
          aria-label={t('sign_out')}
        >
          {t('sign_out')}
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {view === 'chat' && activeTicket ? (
          <div className="h-full">
            <ChatWindow
              key={activeTicket.id}
              ticket={activeTicket}
              onClose={() => { setView('list'); setActiveTicketId(null); }}
            />
          </div>
        ) : view === 'create' ? (
          <div className="p-4 overflow-y-auto h-full">
            <h2 className="text-xl font-bold dark:text-white mb-4">{t('new_ticket')}</h2>
            <form onSubmit={createTicket} className="space-y-4" aria-label={t('new_ticket')}>
              {/* Department selector */}
              <div className="flex flex-wrap gap-2">
                {(manifest.departments || []).map((d: { id: string; label: string }) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDept(d.id)}
                    className={`py-3 px-5 rounded-xl border-2 font-bold text-sm min-h-[44px] ${
                      dept === d.id
                        ? 'border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-400'
                        : 'border-gray-200 dark:border-gray-700 text-gray-500'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>

              {/* Reference */}
              <div>
                <label className="text-xs uppercase font-bold text-gray-500 mb-1 block">{manifest.ref1Label}</label>
                <input
                  type="text"
                  value={ref1}
                  onChange={(e) => setRef1(e.target.value)}
                  className="w-full border dark:border-gray-700 rounded-xl px-4 py-3 text-base dark:bg-gray-900 dark:text-white min-h-[44px]"
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-xs uppercase font-bold text-gray-500 mb-1 block">{t('question_problem')}</label>
                <textarea
                  rows={5}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  required
                  className="w-full border dark:border-gray-700 rounded-xl px-4 py-3 text-base dark:bg-gray-900 dark:text-white resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !text.trim()}
                className="w-full bg-brand-500 text-white py-4 rounded-xl font-bold text-base min-h-[44px] active:scale-95 disabled:opacity-50 transition-transform"
              >
                {loading ? t('connecting') : t('connect_with_support')}
              </button>
            </form>
          </div>
        ) : (
          /* Ticket list */
          <div className="h-full flex flex-col">
            <div className="flex-1 overflow-y-auto">
              {tickets.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 p-8">
                  <p className="text-lg">{t('no_tickets')}</p>
                </div>
              ) : (
                <ul className="divide-y dark:divide-gray-800" role="list" aria-label={t('tickets')}>
                  {tickets.map((ticket) => (
                    <li key={ticket.id}>
                      <button
                        onClick={() => { setActiveTicketId(ticket.id); setView('chat'); }}
                        className="w-full text-left px-4 py-4 active:bg-gray-50 dark:active:bg-gray-900 min-h-[44px]"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium dark:text-white truncate">{ticket.ref1 || ticket.dept}</span>
                          <span className={`text-xs px-2 py-1 rounded-full font-bold ${
                            ticket.status === 'open' ? 'bg-yellow-100 text-yellow-700' :
                            ticket.status === 'active' ? 'bg-green-100 text-green-700' :
                            'bg-gray-100 text-gray-500'
                          }`}>
                            {ticket.status}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* New ticket button */}
            <div className="p-4" style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}>
              <button
                onClick={() => setView('create')}
                className="w-full bg-brand-500 text-white py-4 rounded-xl font-bold text-base min-h-[44px] active:scale-95 transition-transform"
              >
                + {t('new_ticket')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

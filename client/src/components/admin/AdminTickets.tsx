import { useEffect, useState } from 'react';
import useStore from '../../store/useStore';
import { useT } from '../../i18n';
import ChatWindow from '../ChatWindow';
import TicketPreview from '../TicketPreview';
import { Ticket } from '../../types';
import { trpc } from '../../utils/trpc';

function TabIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
    </svg>
  );
}

function SplitIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
    </svg>
  );
}

function VSplitIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v14a1 1 0 01-1 1h-4a1 1 0 01-1-1V5z" />
    </svg>
  );
}

function splitGridClass(count: number) {
  if (count === 1) return 'grid-cols-1 grid-rows-1';
  if (count === 2) return 'grid-cols-2 grid-rows-1';
  return 'grid-cols-2 grid-rows-2';
}

function vsplitGridClass(count: number) {
  if (count === 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-2';
  if (count === 3) return 'grid-cols-3';
  return 'grid-cols-4';
}

export default function AdminTickets() {
  const { user, tickets, setTickets, expertOpenTickets, addExpertOpenTicket, removeExpertOpenTicket, unreadTickets, clearUnread } = useStore();
  const t = useT();

  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'tabs' | 'split' | 'vsplit'>('tabs');
  const [focusedTicketId, setFocusedTicketId] = useState<string | null>(null);
  const [previewTicketId, setPreviewTicketId] = useState<string | null>(null);
  const [previewMessages, setPreviewMessages] = useState<any[]>([]);

  // tRPC: Ticket List
  trpc.ticket.list.useQuery(
    {}, // Open/Pending
    {
      onSuccess: (data) => {
        if (Array.isArray(data)) {
          setTickets(data as any);
        }
      },
      refetchInterval: 30000,
    }
  );

  // tRPC: Preview Messages
  trpc.message.list.useQuery(
    { ticketId: previewTicketId || '' },
    {
      enabled: !!previewTicketId,
      onSuccess: (data) => setPreviewMessages(data as any),
    }
  );

  const openTickets = tickets.filter((tk) => tk.status !== 'closed');
  const previewTicket = previewTicketId ? openTickets.find((tk) => tk.id === previewTicketId) : null;
  const openTabTickets = expertOpenTickets.map((id) => tickets.find((tk) => tk.id === id)).filter((tk): tk is Ticket => !!tk).slice(0, 4);
  const atMaxChats = openTabTickets.length >= 4;

  if (!user) return null;

  function selectOpenTicket(ticket: Ticket) {
    const isParticipant = ticket.participants?.some(p => (typeof p === 'string' ? p === user?.id : p.id === user?.id));
    if (expertOpenTickets.includes(ticket.id) || isParticipant) {
      if (!expertOpenTickets.includes(ticket.id)) {
        addExpertOpenTicket(ticket.id);
      }
      setActiveTab(ticket.id);
      clearUnread(ticket.id);
      setPreviewTicketId(null);
    } else if (!atMaxChats) {
      setPreviewTicketId(ticket.id);
    }
  }

  function joinOpenTicket(ticket: Ticket) {
    addExpertOpenTicket(ticket.id);
    setActiveTab(ticket.id);
    clearUnread(ticket.id);
    setPreviewTicketId(null);
  }

  function closeTab(ticketId: string) {
    removeExpertOpenTicket(ticketId);
    clearUnread(ticketId);
    if (focusedTicketId === ticketId) setFocusedTicketId(null);
    if (activeTab === ticketId) {
      const remaining = openTabTickets.filter((tk) => tk.id !== ticketId);
      setActiveTab(remaining[0]?.id || null);
    }
  }

  return (
    <div className="h-full flex gap-4 animate-fade-in">
      {/* List */}
      <aside className="w-80 glass-panel border-r border-white/20 dark:border-brand-700/50 flex flex-col bg-white/70 dark:bg-brand-900/40 backdrop-blur-xl rounded-2xl overflow-hidden shadow-xl">
        <div className="px-4 py-4 border-b border-solarized-base2 dark:border-brand-700 bg-solarized-base3/50 dark:bg-brand-900/50">
          <h2 className="font-bold text-solarized-base01 dark:text-white text-sm uppercase tracking-wider">{t('active_tickets')}</h2>
          <p className="text-[10px] text-solarized-base1 font-medium mt-1">{openTickets.length} ongoing conversations</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {openTickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <svg className="w-12 h-12 text-solarized-base2 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-solarized-base1 text-sm font-medium">{t('no_open_tickets')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-solarized-base2 dark:divide-brand-700">
              {openTickets.map((tk) => {
                const isActive = activeTab === tk.id || previewTicketId === tk.id;
                const hasUnread = unreadTickets.has(tk.id) && activeTab !== tk.id;
                return (
                  <li
                    key={tk.id}
                    onClick={() => selectOpenTicket(tk)}
                    className={`p-4 cursor-pointer transition-all duration-300 relative border-l-4 ${
                      isActive 
                        ? 'bg-white dark:bg-brand-800 border-l-brand-500 shadow-md translate-x-1' 
                        : 'hover:bg-solarized-base3 dark:hover:bg-brand-850 border-l-transparent'
                    } ${hasUnread ? 'bg-amber-50 dark:bg-amber-900/10' : ''}`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter ${
                        tk.dept === 'DSC' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'
                      }`}>
                        {tk.dept}
                      </span>
                      <span className="text-[10px] font-medium text-solarized-base1">
                        {new Date(tk.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-solarized-base01 dark:text-gray-100 truncate pr-4">{tk.agentName}</p>
                    {tk.expertName && (
                      <p className="text-[11px] text-solarized-base1 font-medium mt-1 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        {tk.expertName}
                      </p>
                    )}
                    {hasUnread && (
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-amber-500 animate-pulse shadow-sm shadow-amber-500/50" />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {previewTicket && !expertOpenTickets.includes(previewTicketId!) ? (
          <div className="flex-1 glass-card rounded-2xl overflow-hidden shadow-2xl border-white/20 dark:border-brand-700/50">
            <TicketPreview
              ticket={previewTicket}
              messages={previewMessages}
              onJoin={() => joinOpenTicket(previewTicket!)}
              onClose={() => setPreviewTicketId(null)}
              joinDisabled={atMaxChats}
            />
          </div>
        ) : openTabTickets.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center glass-card rounded-2xl border-white/20 dark:border-brand-700/50 bg-white/30 dark:bg-brand-900/20 backdrop-blur-sm">
            <div className="w-20 h-20 bg-solarized-base3 dark:bg-brand-800 rounded-3xl flex items-center justify-center mb-6 shadow-soft rotate-3 hover:rotate-0 transition-transform duration-500">
              <svg className="w-10 h-10 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-solarized-base01 dark:text-white pr-2 tracking-tight">Active Cockpit</h3>
            <p className="text-solarized-base1 text-sm mt-2 max-w-xs text-center font-medium">Select an active ticket from the sidebar to oversee or join the conversation.</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-4 bg-white/50 dark:bg-brand-900/40 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/20 dark:border-brand-700/50 shadow-sm">
              <div className="flex items-center gap-1">
                {openTabTickets.map(tk => (
                  <button
                    key={tk.id}
                    onClick={() => setActiveTab(tk.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      activeTab === tk.id 
                        ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/20' 
                        : 'text-solarized-base1 hover:bg-solarized-base2 dark:hover:bg-brand-800'
                    }`}
                  >
                    {tk.agentName.split(' ')[0]}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 bg-black/5 dark:bg-white/5 p-1 rounded-xl">
                <button onClick={() => setViewMode('tabs')} className={`p-1.5 rounded-lg transition-all ${viewMode === 'tabs' ? 'bg-white dark:bg-brand-700 shadow-sm text-brand-500' : 'text-solarized-base1'}`}><TabIcon /></button>
                <button onClick={() => setViewMode('vsplit')} className={`p-1.5 rounded-lg transition-all ${viewMode === 'vsplit' ? 'bg-white dark:bg-brand-700 shadow-sm text-brand-500' : 'text-solarized-base1'}`}><VSplitIcon /></button>
                <button onClick={() => setViewMode('split')} className={`p-1.5 rounded-lg transition-all ${viewMode === 'split' ? 'bg-white dark:bg-brand-700 shadow-sm text-brand-500' : 'text-solarized-base1'}`}><SplitIcon /></button>
              </div>
            </div>

            <div className="flex-1 relative min-h-0">
              {viewMode === 'tabs' ? (
                <div className="h-full bg-white/50 dark:bg-brand-900/40 rounded-2xl overflow-hidden shadow-2xl border border-white/20 dark:border-brand-700/50">
                  {(() => {
                    const tk = openTabTickets.find(t => t.id === activeTab) || openTabTickets[0];
                    return tk ? <ChatWindow key={tk.id} ticket={tk} onClose={() => closeTab(tk.id)} /> : null;
                  })()}
                </div>
              ) : (
                <div className={`h-full grid gap-4 ${viewMode === 'vsplit' ? vsplitGridClass(openTabTickets.length) : splitGridClass(openTabTickets.length)}`}>
                  {openTabTickets.map(tk => (
                    <div key={tk.id} className="min-h-0 bg-white/50 dark:bg-brand-900/40 rounded-2xl overflow-hidden shadow-xl border border-white/20 dark:border-brand-700/50">
                      <ChatWindow ticket={tk} onClose={() => closeTab(tk.id)} onFocus={() => setFocusedTicketId(tk.id)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

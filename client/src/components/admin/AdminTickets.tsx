import { useEffect, useState } from 'react';
import { useStoreShallow } from '../../store/useStore';
import { trpc } from '../../utils/trpc';
import ChatWindow from '../ChatWindow';
import TicketPreview from '../TicketPreview';
import { Ticket, Message } from '../../types';
import { useT } from '../../i18n';

export default function AdminTickets() {
  const { tickets, setTickets, supportOpenTickets, addSupportOpenTicket, removeSupportOpenTicket, unreadTickets, clearUnread } = useStoreShallow((s) => ({
    tickets: s.tickets,
    setTickets: s.setTickets,
    supportOpenTickets: s.supportOpenTickets,
    addSupportOpenTicket: s.addSupportOpenTicket,
    removeSupportOpenTicket: s.removeSupportOpenTicket,
    unreadTickets: s.unreadTickets,
    clearUnread: s.clearUnread,
  }));
  const t = useT();
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [previewTicketId, setPreviewTicketId] = useState<string | null>(null);
  const [previewMessages, setPreviewMessages] = useState<Message[]>([]);

  // tRPC: Ticket List
  const ticketsQuery = trpc.ticket.list.useQuery(
    { status: ['open', 'pending'] },
    {
      refetchInterval: 30000,
    }
  );

  useEffect(() => {
    if (ticketsQuery.data && Array.isArray(ticketsQuery.data)) {
      setTickets(ticketsQuery.data as Ticket[]);
    }
  }, [ticketsQuery.data, setTickets]);

  // tRPC: Preview Messages
  const messagesQuery = trpc.message.list.useQuery(
    { ticketId: previewTicketId || '' },
    {
      enabled: !!previewTicketId,
    }
  );

  useEffect(() => {
    if (messagesQuery.data) {
      setPreviewMessages(messagesQuery.data.messages as unknown as Message[]);
    }
  }, [messagesQuery.data]);

  const atMaxChats = supportOpenTickets.length >= 4;

  const openTabTickets = supportOpenTickets
    .map((id: string) => tickets.find((tk: Ticket) => tk.id === id))
    .filter((tk: Ticket | undefined): tk is Ticket => !!tk)
    .slice(0, 4);

  useEffect(() => {
    if (openTabTickets.length > 0 && !activeTab) {
      setActiveTab(openTabTickets[0].id);
    } else if (openTabTickets.length === 0) {
      setActiveTab(null);
    }
  }, [openTabTickets, activeTab]);

  function closeTab(ticketId: string) {
    removeSupportOpenTicket(ticketId);
    if (activeTab === ticketId) {
      const remaining = openTabTickets.filter((tk: Ticket) => tk.id !== ticketId);
      setActiveTab(remaining.length > 0 ? remaining[0].id : null);
    }
  }

  function handlePreview(ticket: Ticket) {
    if (previewTicketId === ticket.id) {
      clearUnread(ticket.id);
      setPreviewTicketId(null);
    } else if (!atMaxChats) {
      setPreviewTicketId(ticket.id);
    }
  }

  function joinOpenTicket(ticket: Ticket) {
    addSupportOpenTicket(ticket.id);
    setActiveTab(ticket.id);
    setPreviewTicketId(null);
  }

  return (
    <div className="flex h-full overflow-hidden bg-[var(--color-bg-base)]">
      {/* Sidebar: Open Queue */}
      <aside className="w-72 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-bg-surface)]">
        <div className="p-3 border-b border-[var(--color-border)]">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-secondary)]">
            {t('live_queue')} ({tickets.length})
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-[var(--color-text-muted)] opacity-30">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H4a2 2 0 00-2 2v7m18 0a2 2 0 01-2 2H4a2 2 0 01-2-2m18 0l-5 5m-7-5l-5 5" />
              </svg>
              <p className="text-[9px] font-bold uppercase tracking-wider">{t('queue_empty')}</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]/30">
              {tickets.filter(tk => ['open', 'pending'].includes(tk.status)).map((tk) => (
                <button
                  key={tk.id}
                  onClick={() => handlePreview(tk)}
                  className={`w-full text-left px-4 py-3.5 relative group transition-colors ${
                    previewTicketId === tk.id
                      ? 'bg-[var(--color-accent-blue)] text-white'
                      : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.03] text-[var(--color-text-primary)]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 uppercase tracking-widest border ${
                      previewTicketId === tk.id ? 'bg-white/10 border-white/20' : 'bg-bg-elevated border-border'
                    }`}>
                      {tk.dept}
                    </span>
                    <span className={`text-[9px] font-mono tracking-tighter ${previewTicketId === tk.id ? 'text-white/60' : 'text-[var(--color-text-muted)]'}`}>
                      {tk.createdAt ? new Date(tk.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                  <p className="text-xs font-bold truncate pr-6">{tk.agentName}</p>
                  {tk.supportName && (
                    <div className={`flex items-center gap-1.5 mt-1.5 ${previewTicketId === tk.id ? 'text-white/70' : 'text-[var(--color-text-secondary)]'}`}>
                      <div className="w-1 h-1 bg-current" />
                      <p className="text-[10px] truncate font-medium">
                        {tk.supportName}
                      </p>
                    </div>
                  )}
                  {!!unreadTickets[tk.id] && (
                    <span className="absolute top-4 right-4 w-2 h-2 bg-[var(--color-text-primary)] shadow-sm" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Main Area: Preview or Tabs */}
      <main className="flex-1 flex flex-col relative bg-[var(--color-bg-base)]">
        {previewTicketId ? (
          <div className="h-full flex flex-col overflow-hidden">
            <TicketPreview
              ticket={tickets.find((t) => t.id === previewTicketId)!}
              messages={previewMessages}
              onJoin={() => joinOpenTicket(tickets.find((t) => t.id === previewTicketId)!)}
              onClose={() => setPreviewTicketId(null)}
            />
          </div>
        ) : openTabTickets.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-[var(--color-text-muted)]">
            <div className="w-20 h-20 border-2 border-[var(--color-border)] flex items-center justify-center mb-6 opacity-20">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold tracking-tight uppercase text-[var(--color-text-primary)]">{t('active_workspace') || 'Active Workspace'}</h3>
            <p className="text-[10px] font-bold mt-2 uppercase tracking-widest opacity-40">{t('select_ticket_hint') || 'Select a ticket from the queue to start'}</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Tab Bar */}
            <div className="flex bg-[var(--color-bg-surface)] px-2 border-b border-[var(--color-border)] min-h-[44px]">
              {openTabTickets.map((tk: Ticket) => (
                <button
                  key={tk.id}
                  onClick={() => setActiveTab(tk.id)}
                  className={`group flex items-center gap-2.5 px-4 py-2 text-[11px] font-bold relative min-w-[120px] max-w-[180px] transition-colors ${
                    activeTab === tk.id
                      ? 'bg-[var(--color-bg-base)] text-[var(--color-text-primary)] border-x border-[var(--color-border)] -mb-px'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border-x border-transparent'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${activeTab === tk.id ? 'bg-[var(--color-accent-blue)]' : 'bg-current opacity-30'}`} />
                  <span className="truncate flex-1 text-left uppercase tracking-tight">{tk.agentName}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tk.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[var(--color-accent-blue)] hover:text-white transition-all"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  {activeTab === tk.id && (
                    <div className="absolute top-0 left-0 right-0 h-0.5 bg-[var(--color-accent-blue)]" />
                  )}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 relative">
              {openTabTickets.map((tk: Ticket) => (
                <div
                  key={tk.id}
                  className={`absolute inset-0 ${
                    activeTab === tk.id ? 'opacity-100 z-10' : 'opacity-0 -z-10 pointer-events-none'
                  }`}
                >
                  <ChatWindow ticket={tk} onClose={() => closeTab(tk.id)} />
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import useStore from '../../store/useStore';
import { getSocket } from '../../hooks/useSocket';
import { useT } from '../../i18n';
import ChatWindow from '../ChatWindow';
import TicketPreview from '../TicketPreview';
import TicketList from '../TicketList';
import { Ticket } from '../../types';

const DEPT_COLOR: Record<string, string> = { DSC: 'bg-purple-100 text-purple-700', FOT: 'bg-teal-100 text-teal-700' };

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

export default function ManagerTickets() {
  const { user, tickets, setTickets, expertOpenTickets, addExpertOpenTicket, removeExpertOpenTicket, unreadTickets, clearUnread } = useStore();
  const t = useT();

  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'tabs' | 'split' | 'vsplit'>('tabs');
  const [focusedTicketId, setFocusedTicketId] = useState<string | null>(null);
  const [previewTicketId, setPreviewTicketId] = useState<string | null>(null);
  const [previewMessages, setPreviewMessages] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/tickets').then((r) => r.json()).then(setTickets).catch(console.error);
  }, [setTickets]);

  useEffect(() => {
    if (!previewTicketId) return;
    fetch(`/api/messages?ticketId=${previewTicketId}`)
      .then((r) => r.json())
      .then(setPreviewMessages)
      .catch(() => setPreviewMessages([]));
  }, [previewTicketId]);

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
        getSocket().emit('expert:join', { ticketId: ticket.id, expertId: user?.id, expertName: user?.name, expertLang: user?.lang });
      }
      switchTab(ticket.id);
      setPreviewTicketId(null);
    } else if (!atMaxChats) {
      if (previewTicketId === ticket.id) {
        setPreviewTicketId(null);
      } else {
        setPreviewTicketId(ticket.id);
      }
    }
  }

  function joinAsObserver(ticket: Ticket) {
    getSocket().emit('expert:join', { ticketId: ticket.id, expertId: user?.id, expertName: user?.name, expertLang: user?.lang });
    addExpertOpenTicket(ticket.id);
    setActiveTab(ticket.id);
    clearUnread(ticket.id);
    setPreviewTicketId(null);
  }

  function switchTab(ticketId: string) {
    setActiveTab(ticketId);
    clearUnread(ticketId);
  }

  function closeTab(ticketId: string) {
    getSocket().emit('expert:leave', { ticketId, expertId: user?.id, expertName: user?.name });
    removeExpertOpenTicket(ticketId);
    clearUnread(ticketId);
    if (focusedTicketId === ticketId) setFocusedTicketId(null);
    if (activeTab === ticketId) {
      const remaining = openTabTickets.filter((tk) => tk.id !== ticketId);
      setActiveTab(remaining[0]?.id || null);
    }
  }

  return (
    <div className="flex gap-4 items-start h-[calc(100vh-8rem)]">
      <div className="w-80 bg-solarized-base3 dark:bg-brand-800 rounded-xl shadow-sm border border-solarized-base2 dark:border-brand-700 overflow-hidden shrink-0 h-full flex flex-col">
        <div className="px-4 py-3 border-b border-solarized-base2 dark:border-brand-700">
          <h2 className="font-semibold text-solarized-base01 dark:text-gray-300 text-sm">{t('open_tickets')} ({openTickets.length})</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          <TicketList tickets={openTickets} onSelect={selectOpenTicket} activeId={previewTicketId || activeTab} />
        </div>
      </div>

      <div className="flex-1 h-full overflow-hidden flex flex-col">
        {previewTicket ? (
          <TicketPreview
            ticket={previewTicket}
            messages={previewMessages}
            onJoin={() => joinAsObserver(previewTicket)}
            onClose={() => setPreviewTicketId(null)}
            t={t}
            joinDisabled={atMaxChats}
          />
        ) : openTabTickets.length === 0 ? (
          <div className="h-full flex items-center justify-center border border-dashed border-solarized-base2 dark:border-brand-700 rounded-xl">
            <p className="text-solarized-base1">Select a ticket from the queue to observe.</p>
          </div>
        ) : (
          <div className="flex-1 h-full flex flex-col border border-solarized-base2 dark:border-brand-700 rounded-xl overflow-hidden bg-solarized-base3 dark:bg-brand-800">
            <div className="bg-solarized-base2 dark:bg-brand-900 border-b border-solarized-base2 dark:border-brand-700 flex items-center">
              {viewMode === 'tabs' && (
                <div className="flex overflow-x-auto flex-1">
                  {openTabTickets.map((ticket) => {
                    const hasUnread = unreadTickets.has(ticket.id) && activeTab !== ticket.id;
                    return (
                      <button
                        key={ticket.id}
                        onClick={() => switchTab(ticket.id)}
                        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${activeTab === ticket.id
                          ? 'border-brand-500 text-brand-600 dark:text-brand-400 bg-solarized-base3 dark:bg-brand-800'
                          : hasUnread
                            ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 animate-pulse'
                            : 'border-transparent text-solarized-base1 dark:text-gray-400 hover:text-solarized-base01 dark:hover:text-gray-200'
                          }`}
                      >
                        {hasUnread && <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0 animate-bounce" />}
                        <span className={`text-xs px-1.5 py-0.5 rounded ${DEPT_COLOR[ticket.dept]}`}>{ticket.dept}</span>
                        <span className="max-w-32 truncate">{ticket.agentName}</span>
                        {ticket.cdbId && <span className="text-xs font-mono text-gray-400">#{ticket.cdbId}</span>}
                        {ticket.dareRef && <span className="text-xs font-mono text-gray-400">{ticket.dareRef}</span>}
                        <span
                          onClick={(e) => { e.stopPropagation(); closeTab(ticket.id); }}
                          className="ml-1 text-gray-400 hover:text-gray-600 text-base leading-none"
                        >×</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {(viewMode === 'split' || viewMode === 'vsplit') && (
                <div className="flex-1 px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
                  {openTabTickets.length} {openTabTickets.length === 1 ? 'chat' : 'chats'} open
                  {openTabTickets.length < 4 && <span className="ml-2 text-gray-400">· max 4</span>}
                </div>
              )}

              <div className="flex items-center gap-1 px-3 border-l border-solarized-base2 dark:border-brand-700 shrink-0 py-1">
                <button onClick={() => setViewMode('tabs')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'tabs' ? 'bg-solarized-base3 dark:bg-brand-800 text-brand-600 shadow-sm' : 'text-solarized-base1 hover:text-solarized-base01 hover:bg-solarized-base2 dark:hover:bg-brand-700'}`}><TabIcon /></button>
                <button onClick={() => setViewMode('vsplit')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'vsplit' ? 'bg-solarized-base3 dark:bg-brand-800 text-brand-600 shadow-sm' : 'text-solarized-base1 hover:text-solarized-base01 hover:bg-solarized-base2 dark:hover:bg-brand-700'}`}><VSplitIcon /></button>
                <button onClick={() => setViewMode('split')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'split' ? 'bg-solarized-base3 dark:bg-brand-800 text-brand-600 shadow-sm' : 'text-solarized-base1 hover:text-solarized-base01 hover:bg-solarized-base2 dark:hover:bg-brand-700'}`}><SplitIcon /></button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden">
              {viewMode === 'tabs' ? (
                <div className="h-full p-0">
                  {(() => {
                    const ticket = tickets.find((tk) => tk.id === activeTab) || openTabTickets[0];
                    return ticket ? <ChatWindow ticket={ticket} onClose={() => closeTab(ticket.id)} /> : null;
                  })()}
                </div>
              ) : focusedTicketId && openTabTickets.find((tk) => tk.id === focusedTicketId) ? (
                <div className="h-full flex flex-col">
                  {openTabTickets.length > 1 && (
                    <div className="flex items-center gap-1 px-3 py-1.5 bg-solarized-base2 dark:bg-brand-800 border-b border-solarized-base2 dark:border-brand-700 shrink-0">
                      {openTabTickets.map((tk) => {
                        const isFocused = tk.id === focusedTicketId;
                        const hasUnread = unreadTickets.has(tk.id) && !isFocused;
                        return (
                          <button
                            key={tk.id}
                            onClick={() => isFocused ? null : setFocusedTicketId(tk.id)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${isFocused
                              ? 'bg-brand-500 text-white'
                              : hasUnread
                                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 animate-pulse'
                                : 'bg-solarized-base3 dark:bg-gray-700 text-solarized-base1 dark:text-gray-300 hover:bg-solarized-base2 dark:hover:bg-gray-600'
                              }`}
                          >
                            <span className={`text-[10px] px-1 py-0.5 rounded ${DEPT_COLOR[tk.dept]}`}>{tk.dept}</span>
                            <span className="max-w-20 truncate">{tk.agentName}</span>
                            {hasUnread && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => setFocusedTicketId(null)}
                        className="ml-auto text-xs text-solarized-base1 hover:text-solarized-base01 dark:hover:text-gray-200 px-2 py-1 rounded hover:bg-solarized-base2 dark:hover:bg-gray-600 transition-colors"
                      >
                        Show all
                      </button>
                    </div>
                  )}
                  <div className="flex-1 min-h-0 p-0">
                    {(() => {
                       const tk = openTabTickets.find((t) => t.id === focusedTicketId);
                       return tk ? (
                        <ChatWindow
                          ticket={tk}
                          onClose={() => closeTab(focusedTicketId!)}
                          onFocus={() => setFocusedTicketId(null)}
                          focused
                        />
                       ) : null;
                    })()}
                  </div>
                </div>
              ) : (
                <div className={`h-full grid gap-[1px] bg-solarized-base2 dark:bg-brand-700 ${viewMode === 'vsplit' ? vsplitGridClass(openTabTickets.length) : splitGridClass(openTabTickets.length)}`}>
                  {openTabTickets.map((ticket) => (
                    <div key={ticket.id} className="min-h-0 overflow-hidden bg-solarized-base3 dark:bg-brand-800">
                      <ChatWindow
                        ticket={ticket}
                        onClose={() => closeTab(ticket.id)}
                        onFocus={() => setFocusedTicketId(ticket.id)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

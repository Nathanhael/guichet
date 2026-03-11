import React, { useState, useEffect } from 'react';
import useStore from '../../store/useStore';
import { getSocket } from '../../hooks/useSocket';
import { MAX_OPEN_CHATS } from '../../config';
import ChatWindow from '../ChatWindow';
import TicketPreview from '../TicketPreview';
import TicketList from '../TicketList';
import { TabIcon, SplitIcon, VSplitIcon } from './shared/Icons';
import { Ticket, Message } from '../../types';

const DEPT_COLOR: Record<string, string> = { DSC: 'bg-purple-100 text-purple-700', FOT: 'bg-teal-100 text-teal-700' };

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

interface TicketOperationsProps {
  t: (key: string) => string;
}

export default function TicketOperations({ t }: TicketOperationsProps) {
    const { user, token, tickets, expertOpenTickets, addExpertOpenTicket, removeExpertOpenTicket, unreadTickets, clearUnread } = useStore();

    const [activeTab, setActiveTab] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'tabs' | 'split' | 'vsplit'>('tabs');
    const [focusedTicketId, setFocusedTicketId] = useState<string | null>(null);
    const [previewTicketId, setPreviewTicketId] = useState<string | null>(null);
    const [previewMessages, setPreviewMessages] = useState<Message[]>([]);

    const openTickets = tickets.filter((t) => t.status !== 'closed');
    const openTabTickets = expertOpenTickets.map((id) => tickets.find((t) => t.id === id)).filter((t): t is Ticket => !!t).slice(0, MAX_OPEN_CHATS);
    const atMaxChats = openTabTickets.length >= MAX_OPEN_CHATS;

    useEffect(() => {
        if (!previewTicketId) return;
        fetch(`/api/messages?ticketId=${previewTicketId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
            .then((r) => r.json())
            .then(setPreviewMessages)
            .catch(() => setPreviewMessages([]));
    }, [previewTicketId, token]);

    const previewTicket = previewTicketId ? openTickets.find((t) => t.id === previewTicketId) : null;

    function selectOpenTicket(ticket: Ticket) {
        // Participants could be array of strings or objects, handle based on search
        const isParticipant = (ticket.participants as any[])?.some(p => (typeof p === 'object' ? p.id : p) === user?.id);
        
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
            const remaining = openTabTickets.filter((t) => t.id !== ticketId);
            setActiveTab(remaining[0]?.id || null);
        }
    }

    return (
        <div className="flex gap-4 items-start h-[calc(100vh-8rem)]">
            <div className="w-80 bg-white dark:bg-brand-800 rounded-xl shadow-sm border border-gray-100 dark:border-brand-700 overflow-hidden shrink-0 h-full flex flex-col">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-brand-700">
                    <h2 className="font-semibold text-gray-700 dark:text-gray-300 text-sm">{t('open_tickets')} ({openTickets.length})</h2>
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
                    <div className="h-full flex items-center justify-center border border-dashed border-gray-200 dark:border-brand-700 rounded-xl">
                        <p className="text-gray-400">Select a ticket from the queue to observe.</p>
                    </div>
                ) : (
                    <div className="flex-1 h-full flex flex-col border border-gray-200 dark:border-brand-700 rounded-xl overflow-hidden bg-white dark:bg-brand-800">
                        <div className="bg-gray-50 dark:bg-brand-900 border-b border-gray-200 dark:border-brand-700 flex items-center">
                            {viewMode === 'tabs' && (
                                <div className="flex overflow-x-auto flex-1">
                                    {openTabTickets.map((ticket) => {
                                        const hasUnread = unreadTickets.has(ticket.id) && activeTab !== ticket.id;
                                        return (
                                            <button
                                                key={ticket.id}
                                                onClick={() => switchTab(ticket.id)}
                                                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${activeTab === ticket.id
                                                    ? 'border-brand-500 text-brand-600 dark:text-brand-400 bg-white dark:bg-brand-800'
                                                    : hasUnread
                                                        ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 animate-pulse'
                                                        : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                                                    }`}
                                            >
                                                {hasUnread && <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0 animate-bounce" />}
                                                <span className={`text-xs px-1.5 py-0.5 rounded ${DEPT_COLOR[ticket.dept] || 'bg-gray-100'}`}>{ticket.dept}</span>
                                                <span className="max-w-32 truncate">{ticket.agent_name}</span>
                                                {ticket.cdb_id && <span className="text-xs font-mono text-gray-400">#{ticket.cdb_id}</span>}
                                                {ticket.dare_ref && <span className="text-xs font-mono text-gray-400">{ticket.dare_ref}</span>}
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
                            <div className="flex items-center gap-1 px-3 border-l border-gray-200 dark:border-brand-700 shrink-0 py-1">
                                <button onClick={() => setViewMode('tabs')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'tabs' ? 'bg-white dark:bg-brand-800 text-brand-600 shadow-sm' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-brand-700'}`}><TabIcon /></button>
                                <button onClick={() => setViewMode('vsplit')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'vsplit' ? 'bg-white dark:bg-brand-800 text-brand-600 shadow-sm' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-brand-700'}`}><VSplitIcon /></button>
                                <button onClick={() => setViewMode('split')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'split' ? 'bg-white dark:bg-brand-800 text-brand-600 shadow-sm' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-brand-700'}`}><SplitIcon /></button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-hidden">
                            {viewMode === 'tabs' ? (
                                <div className="h-full p-0">
                                    {(() => {
                                        const ticket = tickets.find((t) => t.id === activeTab) || openTabTickets[0];
                                        return ticket ? <ChatWindow ticket={ticket} onClose={() => closeTab(ticket.id)} /> : null;
                                    })()}
                                </div>
                            ) : focusedTicketId && openTabTickets.find((t) => t.id === focusedTicketId) ? (
                                <div className="h-full flex flex-col">
                                    {openTabTickets.length > 1 && (
                                        <div className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 dark:bg-brand-800 border-b border-gray-200 dark:border-brand-700 shrink-0">
                                            {openTabTickets.map((t) => {
                                                const isFocused = t.id === focusedTicketId;
                                                const hasUnread = unreadTickets.has(t.id) && !isFocused;
                                                return (
                                                    <button
                                                        key={t.id}
                                                        onClick={() => isFocused ? null : setFocusedTicketId(t.id)}
                                                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${isFocused
                                                            ? 'bg-brand-500 text-white'
                                                            : hasUnread
                                                                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 animate-pulse'
                                                                : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                                                            }`}
                                                    >
                                                        <span className={`text-[10px] px-1 py-0.5 rounded ${DEPT_COLOR[t.dept] || 'bg-gray-100'}`}>{t.dept}</span>
                                                        <span className="max-w-20 truncate">{t.agent_name}</span>
                                                        {hasUnread && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                                                    </button>
                                                );
                                            })}
                                            <button
                                                onClick={() => setFocusedTicketId(null)}
                                                className="ml-auto text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 px-2 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                                            >
                                                Show all
                                            </button>
                                        </div>
                                    )}
                                    <div className="flex-1 min-h-0 p-0">
                                        <ChatWindow
                                            ticket={openTabTickets.find((t) => t.id === (focusedTicketId || ''))!}
                                            onClose={() => closeTab(focusedTicketId!)}
                                            onFocus={() => setFocusedTicketId(null)}
                                            focused
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div className={`h-full grid gap-[1px] bg-gray-200 dark:bg-brand-700 ${viewMode === 'vsplit' ? vsplitGridClass(openTabTickets.length) : splitGridClass(openTabTickets.length)}`}>
                                    {openTabTickets.map((ticket) => (
                                        <div key={ticket.id} className="min-h-0 overflow-hidden bg-white dark:bg-brand-800">
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

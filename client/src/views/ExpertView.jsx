import React, { useEffect, useRef, useState } from 'react';
import useStore from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { useT } from '../i18n';
import { MAX_OPEN_CHATS, ARCHIVE_PAGE_SIZE } from '../config';
import ChatWindow from '../components/ChatWindow';
import TicketPreview from '../components/TicketPreview';
import DarkModeToggle from '../components/DarkModeToggle';
import CannedResponsePicker from '../components/CannedResponsePicker';
import { requestNotificationPermission, notify } from '../utils/notifications';

const DEPT_COLOR = {
  DSC: 'bg-purple-100 text-purple-700',
  FOT: 'bg-teal-100 text-teal-700',
};

const STATUSES = [
  { key: 'available', label: 'Available', dot: 'bg-green-400' },
  { key: 'break', label: 'Break', dot: 'bg-yellow-400' },
  { key: 'lunch', label: 'Lunch', dot: 'bg-orange-400' },
  { key: 'meeting', label: 'Meeting', dot: 'bg-gray-400' },
];

function statusDot(status) {
  return STATUSES.find((s) => s.key === status)?.dot || 'bg-green-400';
}

function StatusPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onOutsideClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, []);

  const current = STATUSES.find((s) => s.key === value) || STATUSES[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 bg-brand-700 hover:bg-brand-600 rounded-lg px-2.5 py-1.5 transition-colors"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${current.dot}`} />
        <span className="text-xs font-medium text-white">{current.label}</span>
        <svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-36 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden z-50">
          {STATUSES.map((s) => (
            <button
              key={s.key}
              onClick={() => { onChange(s.key); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors ${s.key === value ? 'bg-brand-800 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
              {s.label}
              {s.key === value && (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 ml-auto text-brand-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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

function BellIcon({ muted }) {
  return muted ? (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.73 21a2 2 0 01-3.46 0M3 3l18 18M10.584 10.587A2 2 0 0010 12v1m0 0v3a2 2 0 002 2h.01M10 12H6.5a2 2 0 01-1.98-1.714M17.5 12H14m0 0V9a4 4 0 00-.27-1.44M21 5a9.97 9.97 0 00-5.456-1.91" />
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}

function splitGridClass(count) {
  if (count === 1) return 'grid-cols-1 grid-rows-1';
  if (count === 2) return 'grid-cols-2 grid-rows-1';
  return 'grid-cols-2 grid-rows-2';
}

function vsplitGridClass(count) {
  if (count === 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-2';
  if (count === 3) return 'grid-cols-3';
  return 'grid-cols-4';
}

export default function ExpertView() {
  const { user, token, tickets, setTickets, expertOpenTickets, addExpertOpenTicket, removeExpertOpenTicket, logout, onlineExperts, unreadTickets, clearUnread } = useStore();
  const t = useT();
  const [myStatus, setMyStatus] = useState('available');
  const [activeTab, setActiveTab] = useState(null);
  const [filterDept, setFilterDept] = useState('all');
  const [viewMode, setViewMode] = useState('tabs');
  const notificationsEnabled = useStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useStore((s) => s.setNotificationsEnabled);
  const prevWaitingRef = useRef(null);
  const [previewTicketId, setPreviewTicketId] = useState(null);
  const [previewMessages, setPreviewMessages] = useState([]);
  const [sidebarTab, setSidebarTab] = useState('queue');
  const [archivedTickets, setArchivedTickets] = useState([]);
  const [archiveTotal, setArchiveTotal] = useState(0);
  const [archiveOffset, setArchiveOffset] = useState(0);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveSearch, setArchiveSearch] = useState('');
  const [archiveDept, setArchiveDept] = useState('all');
  const [focusedTicketId, setFocusedTicketId] = useState(null);
  const [toast, setToast] = useState(null);
  const ARCHIVE_LIMIT = ARCHIVE_PAGE_SIZE;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const setAllLabels = useStore(s => s.setAllLabels);
  const allLabels = useStore(s => s.allLabels);

  useEffect(() => {
    fetch('/api/tickets', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then((r) => r.json())
      .then((data) => setTickets(data.filter((t) => t.status !== 'closed')))
      .catch(console.error);

    fetch('/api/labels', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(setAllLabels)
      .catch(console.error);

    fetch('/api/canned-responses', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(useStore.getState().setCannedResponses)
      .catch(console.error);

    if (notificationsEnabled) {
      requestNotificationPermission();
    }
  }, [notificationsEnabled]);

  useEffect(() => {
    if (!previewTicketId) return;
    fetch(`/api/messages?ticketId=${previewTicketId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then((r) => r.json())
      .then((msgs) => setPreviewMessages(msgs.filter((m) => !m.whisper)))
      .catch(() => setPreviewMessages([]));
  }, [previewTicketId]);

  useEffect(() => {
    const count = tickets.filter((t) => t.status !== 'closed' && !t.expertName).length;
    if (prevWaitingRef.current === null) {
      prevWaitingRef.current = count;
      return;
    }
    prevWaitingRef.current = count;
  }, [tickets, notificationsEnabled]);

  function handleStatusChange(status) {
    setMyStatus(status);
    getSocket().emit('status:set', { status });

    // Auto-leave active chats on break or lunch
    if (status === 'break' || status === 'lunch') {
      [...expertOpenTickets].forEach((ticketId) => {
        getSocket().emit('expert:leave', { ticketId, expertId: user.id, expertName: user.name });
        removeExpertOpenTicket(ticketId);
        clearUnread(ticketId);
        if (focusedTicketId === ticketId) setFocusedTicketId(null);
      });
      setActiveTab(null);
    }
  }

  function fetchArchive({ offset = 0, search = archiveSearch, dept = archiveDept, append = false }) {
    setArchiveLoading(true);
    const params = new URLSearchParams({
      status: 'closed',
      limit: ARCHIVE_LIMIT,
      offset,
      ...(dept !== 'all' && { dept }),
      ...(search.trim() && { search: search.trim() }),
    });
    fetch(`/api/tickets?${params}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then((r) => r.json())
      .then(({ tickets, total }) => {
        setArchivedTickets((prev) => append ? [...prev, ...tickets] : tickets);
        setArchiveTotal(total);
        setArchiveOffset(offset + tickets.length);
      })
      .catch(() => { if (!append) setArchivedTickets([]); })
      .finally(() => setArchiveLoading(false));
  }

  function switchSidebarTab(tab) {
    setSidebarTab(tab);
    if (tab === 'archive') {
      setArchivedTickets([]);
      setArchiveOffset(0);
      setArchiveSearch('');
      setArchiveDept('all');
      fetchArchive({ offset: 0, search: '', dept: 'all' });
    }
  }

  useEffect(() => {
    if (sidebarTab !== 'archive') return;
    const timer = setTimeout(() => {
      setArchivedTickets([]);
      setArchiveOffset(0);
      fetchArchive({ offset: 0, search: archiveSearch, dept: archiveDept });
    }, 300);
    return () => clearTimeout(timer);
  }, [archiveSearch, archiveDept]);

  const activeTickets = tickets
    .filter((t) => t.status !== 'closed')
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const waitingTickets = activeTickets.filter((t) => !t.expertName);
  const handledTickets = activeTickets.filter((t) => t.expertName);
  const queueFiltered = filterDept === 'all' ? activeTickets : activeTickets.filter((t) => t.dept === filterDept);
  const openTabTickets = expertOpenTickets
    .map((id) => tickets.find((t) => t.id === id))
    .filter(Boolean)
    .slice(0, MAX_OPEN_CHATS);

  const previewTicket = previewTicketId
    ? (tickets.find((t) => t.id === previewTicketId) || archivedTickets.find((t) => t.id === previewTicketId))
    : null;
  const showPreview = !!previewTicket && !expertOpenTickets.includes(previewTicketId);

  const atMaxChats = openTabTickets.length >= MAX_OPEN_CHATS;

  function selectTicket(ticket) {
    const isParticipant = ticket.participants?.some(p => p.id === user.id);
    if (expertOpenTickets.includes(ticket.id) || isParticipant) {
      if (!expertOpenTickets.includes(ticket.id)) {
        if (atMaxChats) {
          setToast(t('max_chats_reached') || 'You can only have up to 4 active chats at a time.');
          return;
        }
        addExpertOpenTicket(ticket.id);
        getSocket().emit('expert:join', { ticketId: ticket.id, expertId: user.id, expertName: user.name, expertLang: user.lang });
      }
      switchTab(ticket.id);
      setPreviewTicketId(null);
    } else if (!atMaxChats) {
      setPreviewTicketId(ticket.id);
    } else {
      setToast(t('max_chats_reached') || 'You can only have up to 4 active chats at a time.');
    }
  }

  function joinTicket(ticket) {
    if (atMaxChats) {
      setToast(t('max_chats_reached') || 'You can only have up to 4 active chats at a time.');
      return;
    }
    getSocket().emit('expert:join', {
      ticketId: ticket.id,
      expertId: user.id,
      expertName: user.name,
      expertLang: user.lang,
    });
    addExpertOpenTicket(ticket.id);
    setActiveTab(ticket.id);
    clearUnread(ticket.id);
    setPreviewTicketId(null);
  }

  function switchTab(ticketId) {
    setActiveTab(ticketId);
    clearUnread(ticketId);
  }

  function closeTab(ticketId) {
    removeExpertOpenTicket(ticketId);
    clearUnread(ticketId);
    if (focusedTicketId === ticketId) setFocusedTicketId(null);
    if (activeTab === ticketId) {
      const remaining = openTabTickets.filter((t) => t.id !== ticketId);
      setActiveTab(remaining[0]?.id || null);
    }
  }

  return (
    <div className="h-screen bg-transparent animate-fade-in flex flex-col overflow-hidden relative">
      {/* Custom Toast Notification Overlay */}
      <div
        className={`absolute top-20 left-1/2 -translate-x-1/2 z-[100] transition-all duration-300 ease-out flex items-center gap-3 bg-red-600/90 backdrop-blur-md text-white px-5 py-3 rounded-full shadow-2xl shadow-red-600/20 border border-red-500 max-w-md w-full sm:w-auto ${toast ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-4 scale-95 pointer-events-none'
          }`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <span className="text-sm font-semibold tracking-wide">{toast}</span>
      </div>
      <nav className="bg-brand-900/95 backdrop-blur-md text-white px-6 py-3 flex items-center justify-between shadow-lg sticky top-0 z-50 border-b border-brand-800">
        <div className="flex items-center gap-3">
          <span className="font-bold text-xl tracking-tight">M&P Support</span>
          <span className="text-xs bg-brand-800 border border-brand-700 px-2.5 py-1 rounded-md font-semibold tracking-wide">Expert</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-brand-100">{user.name} · {user.lang.toUpperCase()}</span>

          <StatusPicker value={myStatus} onChange={handleStatusChange} />

          <div className="h-4 w-px bg-brand-700"></div>

          <button
            onClick={() => setNotificationsEnabled(!notificationsEnabled)}
            title={notificationsEnabled ? 'Notifications on — click to mute' : 'Notifications off — click to enable'}
            className={`transition-all duration-200 hover:scale-110 ${notificationsEnabled ? 'text-accent-400 hover:text-accent-300' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <BellIcon muted={!notificationsEnabled} />
          </button>
          <DarkModeToggle />
          <button onClick={logout} className="text-brand-200 hover:text-white text-sm font-medium transition-colors">{t('sign_out')}</button>
        </div>
      </nav>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-80 min-h-0 glass-panel border-r border-white/20 dark:border-brand-700/50 flex flex-col z-10">
          {/* Queue header */}
          {sidebarTab === 'queue' && (
            <div className="px-4 py-3 border-b border-gray-100 dark:border-brand-700">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 text-sm uppercase tracking-wide">{t('queue')}</h2>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
                    {queueFiltered.filter(t => !t.expertName).length} {t('waiting')}
                  </span>
                  {queueFiltered.filter(t => t.expertName).length > 0 && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                      {queueFiltered.filter(t => t.expertName).length} {t('active')}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-1">
                {['all', 'DSC', 'FOT'].map((d) => (
                  <button
                    key={d}
                    onClick={() => setFilterDept(d)}
                    className={`flex-1 text-xs py-1 rounded-md transition-colors font-medium ${filterDept === d
                      ? 'bg-brand-500 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                  >
                    {d === 'all' ? t('all') : d}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Archive header */}
          {sidebarTab === 'archive' && (
            <div className="px-4 py-3 border-b border-gray-100 dark:border-brand-700 flex items-center gap-2">
              <button
                onClick={() => switchSidebarTab('queue')}
                className="text-gray-400 hover:text-brand-500 transition-colors"
                title="Back to queue"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h2 className="font-semibold text-gray-700 dark:text-gray-300 text-sm uppercase tracking-wide">Archive</h2>
            </div>
          )}

          {/* Queue */}
          {sidebarTab === 'queue' && (
            <div className="flex-1 overflow-y-auto">
              {queueFiltered.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">{t('no_open_tickets')}</p>
              ) : (
                <div className="space-y-4 pb-4">
                  {/* Waiting Queue */}
                  {queueFiltered.filter(t => !t.expertName).length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 pt-3 pb-1">
                        {t('waiting_badge')}
                      </h3>
                      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                        {queueFiltered.filter(t => !t.expertName).map((ticket) => {
                          const alreadyOpen = expertOpenTickets.includes(ticket.id);
                          const isPreviewed = previewTicketId === ticket.id;
                          const created = new Date(ticket.createdAt);
                          const isToday = new Date().toDateString() === created.toDateString();
                          const tStr = created.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                          const dStr = created.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                          const time = isToday ? tStr : `${dStr} ${tStr}`;
                          return (
                            <li
                              key={ticket.id}
                              onClick={() => selectTicket(ticket)}
                              className={`p-3.5 mt-1 mx-2 rounded-xl cursor-pointer transition-all duration-200 ${isPreviewed || alreadyOpen
                                ? 'glass-card border-l-[4px] border-l-accent-500 shadow-md'
                                : 'bg-white/40 dark:bg-brand-800/40 hover:bg-white/80 dark:hover:bg-brand-800/80 border border-transparent hover:shadow-sm hover:-translate-y-0.5'
                                }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0 pr-2">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${DEPT_COLOR[ticket.dept]}`}>{ticket.dept}</span>
                                    <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">{time}</span>
                                  </div>
                                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate mb-2">{ticket.agentName}</p>

                                  {ticket.participants && Array.isArray(ticket.participants) && ticket.participants.length > 0 && (
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      {ticket.participants.map((p, idx) => {
                                        const isObj = typeof p === 'object' && p !== null;
                                        const pId = isObj ? p.id : p;
                                        const pName = isObj ? p.name : (pId || 'Unknown');
                                        return (
                                          <div
                                            key={`${pId}-${idx}`}
                                            title={pName}
                                            className="w-5 h-5 rounded-full bg-gradient-to-br from-brand-100 to-brand-50 dark:from-brand-800 dark:to-brand-900 text-brand-700 dark:text-brand-300 flex items-center justify-center text-[9px] font-bold shadow-sm"
                                          >
                                            {pName.toString().split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                                {alreadyOpen ? (
                                  <span className="text-xs px-2.5 py-1.5 rounded-lg font-bold bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300 shrink-0 shadow-sm border border-brand-200 dark:border-brand-800">
                                    {t('open')}
                                  </span>
                                ) : (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); joinTicket(ticket); }}
                                    className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all duration-200 whitespace-nowrap shrink-0 shadow-sm hover:translate-y-px ${atMaxChats ? 'opacity-50' : ''
                                      } bg-gradient-to-r from-accent-500 to-rose-500 text-white hover:shadow-md`}
                                  >
                                    {t('join')}
                                  </button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {/* Handled Queue */}
                  {queueFiltered.filter(t => t.expertName).length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 pt-3 pb-1">
                        {t('in_progress')}
                      </h3>
                      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                        {queueFiltered.filter(t => t.expertName).map((ticket) => {
                          const alreadyOpen = expertOpenTickets.includes(ticket.id);
                          const isPreviewed = previewTicketId === ticket.id;
                          const created = new Date(ticket.createdAt);
                          const isToday = new Date().toDateString() === created.toDateString();
                          const tStr = created.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                          const dStr = created.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                          const time = isToday ? tStr : `${dStr} ${tStr}`;
                          return (
                            <li
                              key={ticket.id}
                              onClick={() => selectTicket(ticket)}
                              className={`p-3.5 mt-1 mx-2 rounded-xl cursor-pointer transition-all duration-200 ${isPreviewed || alreadyOpen
                                ? 'glass-card border-l-[4px] border-l-accent-500 shadow-md'
                                : 'bg-white/40 dark:bg-brand-800/40 hover:bg-white/80 dark:hover:bg-brand-800/80 border border-transparent hover:shadow-sm hover:-translate-y-0.5'
                                } opacity-70`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0 pr-2">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${DEPT_COLOR[ticket.dept]}`}>{ticket.dept}</span>
                                    <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">{time}</span>
                                  </div>
                                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate mb-2">{ticket.agentName}</p>

                                  {ticket.participants && Array.isArray(ticket.participants) && ticket.participants.length > 0 && (
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      {ticket.participants.map((p, idx) => {
                                        const isObj = typeof p === 'object' && p !== null;
                                        const pId = isObj ? p.id : p;
                                        const pName = isObj ? p.name : (pId || 'Unknown');
                                        return (
                                          <div
                                            key={`${pId}-${idx}`}
                                            title={pName}
                                            className="w-5 h-5 rounded-full bg-gradient-to-br from-brand-100 to-brand-50 dark:from-brand-800 dark:to-brand-900 text-brand-700 dark:text-brand-300 flex items-center justify-center text-[9px] font-bold shadow-sm"
                                          >
                                            {pName.toString().split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                                {alreadyOpen ? (
                                  <span className="text-xs px-2.5 py-1.5 rounded-lg font-bold bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300 shrink-0 shadow-sm border border-brand-200 dark:border-brand-800">
                                    {t('open')}
                                  </span>
                                ) : (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); joinTicket(ticket); }}
                                    className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all duration-200 whitespace-nowrap shrink-0 shadow-sm hover:translate-y-px ${atMaxChats ? 'opacity-50' : ''
                                      } bg-gradient-to-r from-amber-400 to-amber-500 text-white hover:shadow-md`}
                                  >
                                    {t('jump_in')}
                                  </button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
          }

          {/* Archive */}
          {sidebarTab === 'archive' && (
            <div className="flex flex-col flex-1 min-h-0">
              {/* Search + dept filter */}
              <div className="px-3 py-2 border-b border-gray-100 dark:border-brand-700 space-y-2">
                <input
                  type="text"
                  value={archiveSearch}
                  onChange={(e) => setArchiveSearch(e.target.value)}
                  placeholder="Search name, CDBID, Dare Ref…"
                  className="w-full text-xs border border-gray-200 dark:border-brand-600 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400"
                />
                <div className="flex gap-1">
                  {['all', 'DSC', 'FOT'].map((d) => (
                    <button
                      key={d}
                      onClick={() => setArchiveDept(d)}
                      className={`flex-1 text-xs py-1 rounded-md transition-colors font-medium ${archiveDept === d
                        ? 'bg-brand-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                    >
                      {d === 'all' ? 'All' : d}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {archiveLoading && archivedTickets.length === 0 ? (
                  <p className="text-center text-gray-400 text-sm py-8">Loading…</p>
                ) : archivedTickets.length === 0 ? (
                  <p className="text-center text-gray-400 text-sm py-8">No results.</p>
                ) : (
                  <>
                    <p className="text-xs text-gray-400 px-3 py-2">{archiveTotal} total</p>
                    <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                      {archivedTickets.map((ticket) => {
                        const isPreviewed = previewTicketId === ticket.id;
                        const closedTime = ticket.closedAt
                          ? new Date(ticket.closedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                          : '';
                        return (
                          <li
                            key={ticket.id}
                            onClick={() => setPreviewTicketId(ticket.id)}
                            className={`p-3 cursor-pointer transition-colors ${isPreviewed
                              ? 'bg-brand-50 dark:bg-brand-900/20 border-l-2 border-brand-500'
                              : 'hover:bg-gray-50 dark:hover:bg-brand-700 border-l-2 border-transparent'
                              }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${DEPT_COLOR[ticket.dept]}`}>{ticket.dept}</span>
                              <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">{closedTime}</span>
                            </div>
                            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate mb-1 bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300">{ticket.agentName}</p>

                            {(ticket.cdbId || ticket.dareRef) && (
                              <div className="flex items-center gap-2 text-[11px] font-mono text-gray-500 dark:text-gray-400 mb-1">
                                {ticket.cdbId && <span title="CDBID">#{ticket.cdbId}</span>}
                                {ticket.cdbId && ticket.dareRef && <span className="text-gray-300 dark:text-gray-600">•</span>}
                                {ticket.dareRef && <span title="Dare Ref">{ticket.dareRef}</span>}
                              </div>
                            )}
                            {ticket.expertName && <p className="text-[11px] text-gray-400 font-medium">Expert: {ticket.expertName}</p>}
                            {ticket.closingNotes && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 italic line-clamp-2 border-l-2 border-amber-300 dark:border-amber-700 pl-2">
                                "{ticket.closingNotes}"
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>

                    {archivedTickets.length < archiveTotal && (
                      <div className="px-3 py-3">
                        <button
                          onClick={() => fetchArchive({ offset: archiveOffset, append: true })}
                          disabled={archiveLoading}
                          className="w-full text-xs py-1.5 rounded-lg border border-gray-200 dark:border-brand-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-brand-700 disabled:opacity-40 transition-colors"
                        >
                          {archiveLoading ? 'Loading…' : `Load more (${archiveTotal - archivedTickets.length} remaining)`}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Online experts */}
          <div className="border-t border-gray-100 dark:border-brand-700 px-3 py-2 shrink-0">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1.5 px-1">
              Online experts {onlineExperts.length > 0 && <span className="text-green-500">· {onlineExperts.length}</span>}
            </p>
            {onlineExperts.length === 0 ? (
              <p className="text-xs text-gray-400 px-1">No experts online</p>
            ) : (
              <div className="flex flex-wrap gap-1 px-1">
                {onlineExperts.slice(0, 12).map((e) => (
                  <div
                    key={e.userId}
                    title={`${e.name}${e.status && e.status !== 'available' ? ` · ${e.status}` : ''}`}
                    className="relative w-7 h-7 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 flex items-center justify-center text-xs font-semibold ring-2 ring-white dark:ring-gray-800"
                  >
                    {e.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                    {e.status && e.status !== 'available' && (
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${statusDot(e.status)} ring-1 ring-white dark:ring-gray-800`} />
                    )}
                  </div>
                ))}
                {onlineExperts.length > 12 && (
                  <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 flex items-center justify-center text-xs font-semibold ring-2 ring-white dark:ring-gray-800">
                    +{onlineExperts.length - 12}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Archive toggle — pinned to bottom */}
          <div className="border-t border-gray-100 dark:border-brand-700 p-3 shrink-0">
            <button
              onClick={() => switchSidebarTab(sidebarTab === 'archive' ? 'queue' : 'archive')}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${sidebarTab === 'archive'
                ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-brand-700'
                }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
              Archive
              {sidebarTab === 'archive' && archiveTotal > 0 && (
                <span className="ml-auto text-xs text-gray-400">{archiveTotal} chats</span>
              )}
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 flex flex-col overflow-hidden">

          {/* Tab bar + view toggle */}
          {openTabTickets.length > 0 && (
            <div className="bg-white/50 backdrop-blur-md dark:bg-brand-800 border-b border-gray-200 dark:border-brand-700 flex items-center">
              {viewMode === 'tabs' && (
                <div className="flex overflow-x-auto flex-1">
                  {openTabTickets.map((ticket) => {
                    const hasUnread = unreadTickets.has(ticket.id) && activeTab !== ticket.id;
                    return (
                      <button
                        key={ticket.id}
                        onClick={() => switchTab(ticket.id)}
                        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${activeTab === ticket.id
                          ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                          : hasUnread
                            ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 animate-pulse'
                            : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
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

              {/* View toggle */}
              <div className="flex items-center gap-1 px-3 border-l border-gray-200 dark:border-brand-700 shrink-0">
                <button
                  onClick={() => setViewMode('tabs')}
                  title="Tab view"
                  className={`p-1.5 rounded-md transition-colors ${viewMode === 'tabs' ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-brand-700'}`}
                >
                  <TabIcon />
                </button>
                <button
                  onClick={() => setViewMode('vsplit')}
                  title="Vertical split (columns)"
                  className={`p-1.5 rounded-md transition-colors ${viewMode === 'vsplit' ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-brand-700'}`}
                >
                  <VSplitIcon />
                </button>
                <button
                  onClick={() => setViewMode('split')}
                  title="Grid split (2×2)"
                  className={`p-1.5 rounded-md transition-colors ${viewMode === 'split' ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-brand-700'}`}
                >
                  <SplitIcon />
                </button>
              </div>
            </div>
          )}

          {/* Chat area */}
          <div className="flex-1 overflow-hidden">
            {showPreview ? (
              <TicketPreview
                ticket={previewTicket}
                messages={previewMessages}
                onJoin={() => joinTicket(previewTicket)}
                onClose={() => setPreviewTicketId(null)}
                t={t}
                joinDisabled={atMaxChats}
              />
            ) : openTabTickets.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 p-4">
                <div className="w-16 h-16 bg-brand-50 dark:bg-brand-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                  </svg>
                </div>
                <p className="text-lg font-medium text-gray-500 dark:text-gray-400">{t('ready_to_help')}</p>
                <p className="text-sm mt-1">{t('select_ticket_hint')}</p>
              </div>
            ) : viewMode === 'tabs' ? (
              <div className="h-full p-4">
                {(() => {
                  const ticket = tickets.find((t) => t.id === activeTab) || openTabTickets[0];
                  return ticket
                    ? <ChatWindow key={ticket.id} ticket={ticket} onClose={() => closeTab(ticket.id)} />
                    : null;
                })()}
              </div>
            ) : (
              focusedTicketId && openTabTickets.find((t) => t.id === focusedTicketId) ? (
                <div className="h-full flex flex-col">
                  {/* Option 1: Floating mini-tabs bar */}
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
                            <span className={`text-[10px] px-1 py-0.5 rounded ${DEPT_COLOR[t.dept]}`}>{t.dept}</span>
                            <span className="max-w-20 truncate">{t.agentName}</span>
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


                  <div className="flex-1 min-h-0 p-2">
                    <ChatWindow
                      key={focusedTicketId}
                      ticket={openTabTickets.find((t) => t.id === focusedTicketId)}
                      onClose={() => closeTab(focusedTicketId)}
                      onFocus={() => setFocusedTicketId(null)}
                      focused
                    />
                  </div>
                </div>
              ) : (
                <div className={`h-full grid gap-2 p-2 ${viewMode === 'vsplit' ? vsplitGridClass(openTabTickets.length) : splitGridClass(openTabTickets.length)}`}>
                  {openTabTickets.map((ticket) => (
                    <div key={ticket.id} className="min-h-0 overflow-hidden">
                      <ChatWindow
                        ticket={ticket}
                        onClose={() => closeTab(ticket.id)}
                        onFocus={() => setFocusedTicketId(ticket.id)}
                      />
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </main>
      </div >
    </div >
  );
}


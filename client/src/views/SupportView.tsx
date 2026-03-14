import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useStore from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { useT } from '../i18n';
import { MAX_OPEN_CHATS, ARCHIVE_PAGE_SIZE } from '../config';
import ChatWindow from '../components/ChatWindow';
import TicketPreview from '../components/TicketPreview';
import AmbientBackground from '../components/AmbientBackground';
import DarkModeToggle from '../components/DarkModeToggle';
import NeuroToggle from '../components/NeuroToggle';
import LanguageSwitcher from '../components/LanguageSwitcher';
import PartnerSwitcher from '../components/PartnerSwitcher';
import { requestNotificationPermission } from '../utils/notifications';
import { Ticket } from '../types';
import { getTicketTime } from '../utils/dateUtils';
import { trpc } from '../utils/trpc';

const DEPT_COLOR: Record<string, string> = {
  DSC: 'bg-purple-100 text-purple-700',
  FOT: 'bg-teal-100 text-teal-700',
};

interface StatusOption {
  key: string;
  label: string;
  dot: string;
}

const STATUSES: StatusOption[] = [
  { key: 'available', label: 'status_available', dot: 'bg-green-400' },
  { key: 'break', label: 'status_break', dot: 'bg-yellow-400' },
  { key: 'lunch', label: 'status_lunch', dot: 'bg-orange-400' },
  { key: 'meeting', label: 'status_meeting', dot: 'bg-red-400' },
  { key: 'training', label: 'status_training', dot: 'bg-blue-400' },
];

function statusDot(status: string) {
  return STATUSES.find((s) => s.key === status)?.dot || 'bg-green-400';
}

function StatusPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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
        <span className="text-xs font-medium text-white">{t(current.label)}</span>
        <svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 text-solarized-base1 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-36 bg-white dark:bg-gray-900 border border-solarized-base2 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden z-50">
          {STATUSES.map((s) => (
            <button
              key={s.key}
              onClick={() => { onChange(s.key); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors ${s.key === value ? 'bg-solarized-base2 dark:bg-brand-800 text-solarized-base01 dark:text-white' : 'text-solarized-base1 dark:text-gray-300 hover:bg-solarized-base2 dark:hover:bg-gray-800 hover:text-solarized-base01 dark:hover:text-white'
                }`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
              {t(s.label)}
              {s.key === value && (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 ml-auto text-brand-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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

function BellIcon({ muted }: { muted: boolean }) {
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

export default function SupportView() {
  const { user, tickets, setTickets, supportOpenTickets, addSupportOpenTicket, removeSupportOpenTicket, logout, unreadTickets, clearUnread, setAllLabels, setCannedResponses, focusMode, toggleFocusMode, activePartnerId, memberships, activeMembershipId, onlineSupportUsers } = useStore();
  const t = useT();
  const [myStatus, setMyStatus] = useState('available');
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [filterDept, setFilterDept] = useState('all');
  const [viewMode, setViewMode] = useState<'tabs' | 'split' | 'vsplit'>('tabs');
  const notificationsEnabled = useStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useStore((s) => s.setNotificationsEnabled);
  const [previewTicketId, setPreviewTicketId] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'queue' | 'archive'>('queue');
  const [archivedTickets, setArchivedTickets] = useState<Ticket[]>([]);
  const [archiveTotal, setArchiveTotal] = useState(0);
  const [archiveOffset, setArchiveOffset] = useState(0);
  const [archiveSearch, setArchiveSearch] = useState('');
  const [archiveDept, setArchiveDept] = useState('all');
  const [focusedTicketId, setFocusedTicketId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const ARCHIVE_LIMIT = ARCHIVE_PAGE_SIZE;

  // tRPC: Labels & Canned Responses
  const labelsQuery = trpc.label.list.useQuery(undefined, {
    enabled: !!activePartnerId,
  });
  useEffect(() => {
    if (labelsQuery.data) setAllLabels(labelsQuery.data as any);
  }, [labelsQuery.data, setAllLabels]);

  const cannedResponsesQuery = trpc.cannedResponse.list.useQuery(
    { partnerId: activePartnerId || '' },
    { enabled: !!activePartnerId }
  );
  useEffect(() => {
    if (cannedResponsesQuery.data) setCannedResponses(cannedResponsesQuery.data as any);
  }, [cannedResponsesQuery.data, setCannedResponses]);

  // tRPC: Active Tickets
  const ticketsQuery = trpc.ticket.list.useQuery(
    {}, // Open/Pending
    {
      refetchInterval: 30000,
    }
  );
  useEffect(() => {
    if (ticketsQuery.data && Array.isArray(ticketsQuery.data)) {
      setTickets(ticketsQuery.data.filter((tk) => tk.status !== 'closed') as any);
    }
  }, [ticketsQuery.data, setTickets]);

  // tRPC: Preview Messages
  const previewMessagesQuery = trpc.message.list.useQuery(
    { ticketId: previewTicketId || '' },
    {
      enabled: !!previewTicketId,
    }
  );
  const previewMessages = (previewMessagesQuery.data || []) as any[];

  // tRPC: Set Status
  const setStatusMutation = trpc.presence.setStatus.useMutation();

  const activeMembership = memberships.find(m => m.id === activeMembershipId);
  const partnerName = activeMembership?.partnerName || 'Tessera';

  useEffect(() => {
    if (!toast) return;
    const tim = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(tim);
  }, [toast]);

  useEffect(() => {
    if (notificationsEnabled) {
      requestNotificationPermission();
    }
  }, [notificationsEnabled]);

  function handleStatusChange(status: string) {
    if (!user) return;
    setMyStatus(status);
    setStatusMutation.mutate({ userId: user.id, status });

    // Auto-leave active chats on break or lunch
    if (status === 'break' || status === 'lunch') {
      [...supportOpenTickets].forEach((ticketId) => {
        getSocket().emit('support:leave', { ticketId, supportId: user.id, supportName: user.name });
        removeSupportOpenTicket(ticketId);
        clearUnread(ticketId);
        if (focusedTicketId === ticketId) setFocusedTicketId(null);
      });
      setActiveTab(null);
    }
  }

  // paginated fetch for archive using tRPC
  const archiveQuery = trpc.ticket.list.useQuery(
    {
      status: 'closed',
      limit: ARCHIVE_LIMIT,
      offset: archiveOffset,
      dept: archiveDept === 'all' ? undefined : archiveDept,
      search: archiveSearch.trim() || undefined,
    },
    {
      enabled: sidebarTab === 'archive',
    }
  );

  useEffect(() => {
    if (archiveQuery.data) {
      const data = archiveQuery.data as any;
      if (data.tickets) {
        setArchivedTickets((prev) => archiveOffset === 0 ? data.tickets : [...prev, ...data.tickets]);
        setArchiveTotal(data.total);
      }
    }
  }, [archiveQuery.data, archiveOffset]);

  function switchSidebarTab(tab: 'queue' | 'archive') {
    setSidebarTab(tab);
    if (tab === 'archive') {
      setArchiveOffset(0);
      setArchiveSearch('');
      setArchiveDept('all');
    }
  }

  const activeTicketsList = tickets
    .filter((tk) => tk.status !== 'closed')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  
  const queueFiltered = filterDept === 'all' ? activeTicketsList : activeTicketsList.filter((tk) => tk.dept === filterDept);
  
  const openTabTickets = supportOpenTickets
    .map((id) => tickets.find((tk) => tk.id === id))
    .filter((tk): tk is Ticket => !!tk)
    .slice(0, MAX_OPEN_CHATS);

  const previewTicket = previewTicketId
    ? (tickets.find((tk) => tk.id === previewTicketId) || archivedTickets.find((tk) => tk.id === previewTicketId))
    : null;
  const showPreview = !!previewTicket && !supportOpenTickets.includes(previewTicketId!);

  const atMaxChats = openTabTickets.length >= MAX_OPEN_CHATS;

  function selectTicket(ticket: Ticket) {
    if (!user) return;
    const isParticipant = ticket.participants?.some(p => {
        if (typeof p === 'string') return p === user.id;
        return p.id === user.id;
    });
    if (supportOpenTickets.includes(ticket.id) || isParticipant) {
      if (!supportOpenTickets.includes(ticket.id)) {
        if (atMaxChats) {
          setToast(t('max_chats_reached') || 'You can only have up to 4 active chats at a time.');
          return;
        }
        addSupportOpenTicket(ticket.id);
        getSocket().emit('support:join', { ticketId: ticket.id, supportId: user.id, supportName: user.name, supportLang: user.lang });
      }
      switchTab(ticket.id);
      setPreviewTicketId(null);
    } else if (!atMaxChats) {
      setPreviewTicketId(ticket.id);
    } else {
      setToast(t('max_chats_reached') || 'You can only have up to 4 active chats at a time.');
    }
  }

  function joinTicket(ticket: Ticket) {
    if (!user) return;
    if (atMaxChats) {
      setToast(t('max_chats_reached') || 'You can only have up to 4 active chats at a time.');
      return;
    }
    getSocket().emit('support:join', {
      ticketId: ticket.id,
      supportId: user.id,
      supportName: user.name,
      supportLang: user.lang,
    });
    addSupportOpenTicket(ticket.id);
    setActiveTab(ticket.id);
    clearUnread(ticket.id);
    setPreviewTicketId(null);
  }

  function switchTab(ticketId: string) {
    setActiveTab(ticketId);
    clearUnread(ticketId);
  }

  function closeTab(ticketId: string) {
    removeSupportOpenTicket(ticketId);
    clearUnread(ticketId);
    if (focusedTicketId === ticketId) setFocusedTicketId(null);
    if (activeTab === ticketId) {
      const remaining = openTabTickets.filter((tk) => tk.id !== ticketId);
      setActiveTab(remaining[0]?.id || null);
    }
  }

  if (!user) return null;

  return (
    <div className={`h-screen bg-transparent animate-fade-in flex flex-col overflow-hidden relative transition-all duration-700 ${focusMode ? 'zen-mode' : ''}`}>
      <AnimatePresence>
        {focusMode && <AmbientBackground />}
      </AnimatePresence>

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
      <nav className={`px-6 transition-all duration-500 flex items-center justify-between shadow-lg sticky top-0 z-50 border-b ${
        focusMode 
          ? 'py-1.5 bg-brand-900/40 backdrop-blur-2xl border-brand-700/50' 
          : 'py-3 bg-brand-900/95 backdrop-blur-md border-brand-800'
      } text-white`}>
        <div className="flex items-center gap-3">
          <span className={`font-bold transition-all duration-500 tracking-tight ${focusMode ? 'text-lg opacity-80' : 'text-xl'}`}>{partnerName} Support</span>
          {!focusMode && (
            <span className={`text-xs px-2.5 py-1 rounded-md font-semibold tracking-wide transition-colors bg-brand-800 border border-brand-700`}>Support</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-solarized-base2">{user.name} · {user.lang.toUpperCase()}</span>
          
          <div className="flex items-center gap-3">
            <PartnerSwitcher />
            <StatusPicker value={myStatus} onChange={handleStatusChange} />
            
            <div className="flex items-center gap-1 bg-black/10 dark:bg-white/5 p-0.5 rounded-lg border border-white/5 ml-2">
              <LanguageSwitcher />
              <button
                onClick={toggleFocusMode}
                title={focusMode ? t('exit_zen_mode') : t('enter_zen_mode')}
                aria-label="Toggle Zen Mode"
                className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all duration-300 flex items-center justify-center border border-transparent ${
                  focusMode 
                    ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/20 ring-1 ring-brand-400' 
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${focusMode ? 'animate-pulse' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </button>
              <NeuroToggle />
              <DarkModeToggle />
              
              <button
                onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                title={notificationsEnabled ? t('notifications_on') : t('notifications_off')}
                aria-label={notificationsEnabled ? t('mute_notifications') : t('enable_notifications')}
                className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all duration-300 flex items-center justify-center border border-transparent ${
                  notificationsEnabled 
                    ? 'bg-white/20 dark:bg-white/10 text-white shadow-sm ring-1 ring-white/10' 
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                }`}
              >
                <BellIcon muted={!notificationsEnabled} />
              </button>
            </div>

            <button onClick={logout} className="text-brand-200 hover:text-rose-400 text-sm font-medium ml-2 transition-colors">{t('sign_out')}</button>
          </div>
        </div>
      </nav>

      <motion.div layout className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <AnimatePresence mode="popLayout">
          {!focusMode && (
            <motion.aside
              layout
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="min-h-0 glass-panel border-r border-white/20 dark:border-brand-700/50 flex flex-col z-10 bg-white/70 dark:bg-brand-900/40 backdrop-blur-xl overflow-hidden"
            >
                  {/* Queue header */}
              {sidebarTab === 'queue' && (
                <div className="px-4 py-3 border-b border-solarized-base2 dark:border-brand-700">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="font-semibold text-solarized-base01 dark:text-solarized-base1 text-sm uppercase tracking-wide">{t('queue')}</h2>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
                        {queueFiltered.filter(tk => !tk.supportName).length} {t('waiting')}
                      </span>
                      {queueFiltered.filter(tk => tk.supportName).length > 0 && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                          {queueFiltered.filter(tk => tk.supportName).length} {t('active')}
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
                          : 'bg-solarized-base2 dark:bg-gray-700 text-solarized-base1 dark:text-gray-400 hover:bg-solarized-base1 dark:hover:bg-gray-600'
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
                <div className="px-4 py-3 border-b border-solarized-base2 dark:border-brand-700 flex items-center gap-2">
                  <button
                    onClick={() => switchSidebarTab('queue')}
                    className="text-solarized-base1 hover:text-brand-500 transition-colors"
                    title={t('back_to_queue')}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <h2 className="font-semibold text-solarized-base01 dark:text-solarized-base1 text-sm uppercase tracking-wide">{t('archive')}</h2>
                </div>
              )}
    
              {/* Queue */}
              {sidebarTab === 'queue' && (
                <div className="flex-1 overflow-y-auto">
                  {queueFiltered.length === 0 ? (
                    <p className="text-center text-solarized-base1 text-sm py-8">{t('no_open_tickets')}</p>
                  ) : (
                    <div className="space-y-4 pb-4">
                      {/* Waiting Queue */}
                      {queueFiltered.filter(tk => !tk.supportName).length > 0 && (
                        <div>
                          <h3 className="text-xs font-semibold text-solarized-base1 uppercase tracking-wider px-4 pt-3 pb-1">
                            {t('waiting_badge')}
                          </h3>
                          <ul className="divide-y divide-solarized-base2 dark:divide-gray-700">
                            {queueFiltered.filter(tk => !tk.supportName).map((ticket) => {
                              const alreadyOpen = supportOpenTickets.includes(ticket.id);
                              const isPreviewed = previewTicketId === ticket.id;
                              const time = getTicketTime(ticket.createdAt);
                              return (
                                <li
                                  key={ticket.id}
                                  onClick={() => selectTicket(ticket)}
                                  className={`p-3.5 mt-1 mx-2 rounded-xl cursor-pointer transition-all duration-200 ${isPreviewed || alreadyOpen
                                    ? 'bg-white dark:bg-brand-800 border-l-[4px] border-l-accent-500 shadow-md'
                                    : 'bg-solarized-base3/40 dark:bg-brand-800/40 hover:bg-solarized-base3/80 dark:hover:bg-brand-800/80 border border-transparent hover:shadow-sm hover:-translate-y-0.5'
                                    }`}
                                >
                                  <div className="flex justify-between gap-3">
                                    {/* Left side: Info */}
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${DEPT_COLOR[ticket.dept] || 'bg-slate-100 text-slate-700'}`}>{ticket.dept}</span>
                                        <span className="text-[10px] font-medium text-solarized-base1">{time}</span>
                                      </div>
                                      <p className="text-sm font-semibold text-solarized-base01 dark:text-gray-100 truncate">{ticket.agentName}</p>
                                    </div>
    
                                    {/* Right side: Actions & Bubbles */}
                                    <div className="flex flex-col items-end shrink-0 gap-2">
                                      {alreadyOpen ? (
                                        <span 
                                          className="text-xs px-2.5 py-1 rounded-lg font-bold bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300 shadow-sm border border-brand-200 dark:border-brand-800"
                                          onClick={(e) => { e.stopPropagation(); switchTab(ticket.id); }}
                                        >
                                          {t('open')}
                                        </span>
                                      ) : (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); joinTicket(ticket); }}
                                          disabled={atMaxChats}
                                          className={`text-xs px-3 py-1 rounded-lg font-semibold transition-all duration-200 whitespace-nowrap shadow-sm hover:translate-y-px ${atMaxChats ? 'opacity-50' : ''
                                            } bg-gradient-to-r from-accent-500 to-rose-500 text-white hover:shadow-md`}
                                        >
                                          {t('join')}
                                        </button>
                                      )}
    
                                      {ticket.participants && Array.isArray(ticket.participants) && ticket.participants.length > 0 && (
                                        <div className="flex items-center -space-x-1.5 overflow-hidden">
                                          {ticket.participants.map((p, idx) => {
                                            const pObj = typeof p === 'object' ? p : { name: p || 'Unknown', avatar: null };
                                            const pName = pObj.name;
                                            const pAvatar = (pObj as {avatar?: string}).avatar;
                                            return (
                                              <div
                                                key={idx}
                                                title={pName}
                                                className="w-6 h-6 rounded-full border-2 border-white dark:border-brand-800 bg-brand-50 dark:bg-brand-900 flex items-center justify-center text-[10px] font-bold shadow-sm overflow-hidden"
                                              >
                                                {pAvatar ? (
                                                  <img src={pAvatar} alt={pName} className="w-full h-full object-cover" />
                                                ) : (
                                                  <span className="text-brand-700 dark:text-brand-300">
                                                    {pName.toString().split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}                                                  </span>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
    
                      {/* Handled Queue */}
                      {queueFiltered.filter(tk => tk.supportName).length > 0 && (
                        <div>
                          <h3 className="text-xs font-semibold text-solarized-base1 uppercase tracking-wider px-4 pt-3 pb-1">
                            {t('in_progress')}
                          </h3>
                          <ul className="divide-y divide-solarized-base2 dark:divide-gray-700">
                            {queueFiltered.filter(tk => tk.supportName).map((ticket) => {
                              const alreadyOpen = supportOpenTickets.includes(ticket.id);
                              const isPreviewed = previewTicketId === ticket.id;
                              const time = getTicketTime(ticket.createdAt);
                              return (
                                <li
                                  key={ticket.id}
                                  onClick={() => selectTicket(ticket)}
                                  className={`p-3.5 mt-1 mx-2 rounded-xl cursor-pointer transition-all duration-200 ${isPreviewed || alreadyOpen
                                    ? 'bg-white dark:bg-brand-800 border-l-[4px] border-l-accent-500 shadow-md'
                                    : 'bg-solarized-base3/40 dark:bg-brand-800/40 hover:bg-solarized-base3/80 dark:hover:bg-brand-800/80 border border-transparent hover:shadow-sm hover:-translate-y-0.5'
                                    } opacity-70`}
                                >
                                  <div className="flex justify-between gap-3">
                                    {/* Left side: Info */}
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${DEPT_COLOR[ticket.dept] || 'bg-slate-100 text-slate-700'}`}>{ticket.dept}</span>
                                        <span className="text-[10px] font-medium text-solarized-base1">{time}</span>
                                      </div>
                                      <p className="text-sm font-semibold text-solarized-base01 dark:text-gray-100 truncate">{ticket.agentName}</p>
                                    </div>
    
                                    {/* Right side: Actions & Bubbles */}
                                    <div className="flex flex-col items-end shrink-0 gap-2">
                                      {alreadyOpen ? (
                                        <span 
                                          className="text-xs px-2.5 py-1 rounded-lg font-bold bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300 shadow-sm border border-brand-200 dark:border-brand-800"
                                          onClick={(e) => { e.stopPropagation(); switchTab(ticket.id); }}
                                        >
                                          {t('open')}
                                        </span>
                                      ) : (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); joinTicket(ticket); }}
                                          disabled={atMaxChats}
                                          className={`text-xs px-3 py-1 rounded-lg font-semibold transition-all duration-200 whitespace-nowrap shadow-sm hover:translate-y-px ${atMaxChats ? 'opacity-50' : ''
                                            } bg-gradient-to-r from-amber-400 to-amber-500 text-white hover:shadow-md`}
                                        >
                                          {t('jump_in')}
                                        </button>
                                      )}
    
                                      {ticket.participants && Array.isArray(ticket.participants) && ticket.participants.length > 0 && (
                                        <div className="flex items-center -space-x-1.5 overflow-hidden">
                                          {ticket.participants.map((p, idx) => {
                                            const pObj = typeof p === 'object' ? p : { name: p || 'Unknown', avatar: null };
                                            const pName = pObj.name;
                                            const pAvatar = (pObj as {avatar?: string}).avatar;
                                            return (
                                              <div
                                                key={idx}
                                                title={pName}
                                                className="w-6 h-6 rounded-full border-2 border-white dark:border-brand-800 bg-brand-50 dark:bg-brand-900 flex items-center justify-center text-[10px] font-bold shadow-sm overflow-hidden"
                                              >
                                                {pAvatar ? (
                                                  <img src={pAvatar} alt={pName} className="w-full h-full object-cover" />
                                                ) : (
                                                  <span className="text-brand-700 dark:text-brand-300">
                                                    {pName.toString().split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}                                                  </span>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
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
              )}
    
              {/* Archive */}
              {sidebarTab === 'archive' && (
                <div className="flex flex-col flex-1 min-h-0">
                  {/* Search + dept filter */}
                  <div className="px-3 py-2 border-b border-solarized-base2 dark:border-brand-700 space-y-2">
                    <input
                      type="text"
                      value={archiveSearch}
                      onChange={(e) => { setArchiveOffset(0); setArchiveSearch(e.target.value); }}
                      placeholder={t('archive_search_placeholder')}
                      className="w-full text-xs border border-solarized-base2 dark:border-brand-600 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white dark:bg-gray-700 text-solarized-base01 dark:text-gray-100 placeholder-solarized-base1"
                    />
                    <div className="flex gap-1">
                      {['all', 'DSC', 'FOT'].map((d) => (
                        <button
                          key={d}
                          onClick={() => { setArchiveOffset(0); setArchiveDept(d); }}
                          className={`flex-1 text-xs py-1 rounded-md transition-colors font-medium ${archiveDept === d
                            ? 'bg-brand-500 text-white'
                            : 'bg-solarized-base2 dark:bg-gray-700 text-solarized-base1 dark:text-gray-400 hover:bg-solarized-base1 dark:hover:bg-gray-600'
                            }`}
                        >
                          {d === 'all' ? t('all') : d}
                        </button>
                      ))}
                    </div>
                  </div>
    
                  <div className="flex-1 overflow-y-auto">
                    {archiveQuery.isLoading && archivedTickets.length === 0 ? (
                      <p className="text-center text-solarized-base1 text-sm py-8">{t('loading')}</p>
                    ) : archivedTickets.length === 0 ? (
                      <p className="text-center text-solarized-base1 text-sm py-8">{t('no_results')}</p>
                    ) : (
                      <>
                        <p className="text-xs text-solarized-base1 px-3 py-2">{archiveTotal} {t('total_count')}</p>
                        <ul className="divide-y divide-solarized-base2 dark:divide-gray-700">
                          {archivedTickets.map((ticket) => {
                            const isPreviewed = previewTicketId === ticket.id;
                            const closedTime = getTicketTime(ticket.closedAt || undefined);
                            return (
                              <li
                                key={ticket.id}
                                onClick={() => setPreviewTicketId(ticket.id)}
                                className={`p-3 cursor-pointer transition-colors ${isPreviewed
                                  ? 'bg-solarized-base2 dark:bg-brand-900/20 border-l-2 border-brand-500'
                                  : 'hover:bg-solarized-base2 dark:hover:bg-brand-700 border-l-2 border-transparent'
                                  }`}
                              >
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${DEPT_COLOR[ticket.dept] || 'bg-slate-100 text-slate-700'}`}>{ticket.dept}</span>
                                  <span className="text-[10px] font-medium text-solarized-base1">{closedTime}</span>
                                </div>
                                <p className="text-sm font-semibold text-solarized-base01 dark:text-gray-100 truncate mb-1">{ticket.agentName}</p>
    
                                {(ticket.cdbId || ticket.dareRef) && (
                                  <div className="flex items-center gap-2 text-[11px] font-mono text-solarized-base1 mb-1">
                                    {ticket.cdbId && <span title="CDBID">#{ticket.cdbId}</span>}
                                    {ticket.cdbId && ticket.dareRef && <span>•</span>}
                                    {ticket.dareRef && <span title="Dare Ref">{ticket.dareRef}</span>}
                                  </div>
                                )}
                                {ticket.supportName && <p className="text-[11px] text-solarized-base1 font-medium">{t('support_prefix')} {ticket.supportName}</p>}
                                {ticket.closingNotes && (
                                  <p className="text-xs text-solarized-base1 mt-1.5 italic line-clamp-2 border-l-2 border-amber-300 dark:border-amber-700 pl-2">
                                    {ticket.closingNotes}
                                  </p>
                                )}
                              </li>
                            );
                          })}
                        </ul>
    
                        {archivedTickets.length < archiveTotal && (
                          <div className="px-3 py-3">
                            <button
                              onClick={() => setArchiveOffset(archivedTickets.length)}
                              disabled={archiveQuery.isFetching}
                              className="w-full text-xs py-1.5 rounded-lg border border-gray-200 dark:border-brand-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-brand-700 disabled:opacity-40 transition-colors"
                            >
                              {archiveQuery.isFetching ? t('loading') : `${t('load_more')} (${archiveTotal - archivedTickets.length} ${t('remaining')})`}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
    
              {/* Online support */}
              <div className="border-t border-solarized-base2 dark:border-brand-700 px-3 py-2 shrink-0">
                <p className="text-xs text-solarized-base1 uppercase tracking-wide mb-1.5 px-1">
                  {t('online_support')} {onlineSupportUsers.length > 0 && <span className="text-green-500">· {onlineSupportUsers.length}</span>}
                </p>
                {onlineSupportUsers.length === 0 ? (
                  <p className="text-xs text-solarized-base1 px-1">{t('no_support_online')}</p>
                ) : (
                  <div className="flex flex-wrap gap-1 px-1">
                    {onlineSupportUsers.slice(0, 12).map((e) => (
                      <div
                        key={e.userId}
                        title={`${e.name}${e.status && e.status !== 'available' ? ` · ${t(STATUSES.find(s => s.key === e.status)?.label || '')}` : ''}`}
                        className="relative w-7 h-7 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 flex items-center justify-center text-xs font-semibold ring-2 ring-white dark:ring-gray-800"
                      >
                        {e.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                        {e.status && e.status !== 'available' && (
                          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${statusDot(e.status)} ring-1 ring-white dark:ring-gray-800`} />
                        )}
                      </div>
                    ))}
                    {onlineSupportUsers.length > 12 && (
                      <div className="w-7 h-7 rounded-full bg-solarized-base2 dark:bg-gray-700 text-solarized-base1 dark:text-gray-400 flex items-center justify-center text-xs font-semibold ring-2 ring-white dark:ring-gray-800">
                        +{onlineSupportUsers.length - 12}
                      </div>
                    )}
                  </div>
                )}
              </div>
    
              {/* Archive toggle — pinned to bottom */}
              <div className="border-t border-solarized-base2 dark:border-brand-700 p-3 shrink-0">
                <button
                  onClick={() => switchSidebarTab(sidebarTab === 'archive' ? 'queue' : 'archive')}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${sidebarTab === 'archive'
                    ? 'bg-solarized-base2 dark:bg-brand-900/30 text-solarized-base01 dark:text-brand-400'
                    : 'text-solarized-base1 dark:text-gray-400 hover:bg-solarized-base2 dark:hover:bg-brand-700'
                    }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                  {t('archive')}
                  {sidebarTab === 'archive' && archiveTotal > 0 && (
                    <span className="ml-auto text-xs text-solarized-base1">{archiveTotal} {t('total_chats')}</span>
                  )}
                </button>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main */}
        <main className={`flex-1 flex flex-col overflow-hidden transition-all duration-700 ${
          focusMode ? 'm-4 rounded-3xl zen-glass z-10' : ''
        }`}>
          {/* Tab bar + view toggle */}
          {openTabTickets.length > 0 && (
            <div className={`border-b transition-colors duration-500 flex items-center ${
              focusMode 
                ? 'bg-transparent border-white/10' 
                : 'bg-solarized-base3 dark:bg-brand-800 border-solarized-base2 dark:border-brand-700'
            }`}>
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
                            : 'border-transparent text-solarized-base1 dark:text-gray-400 hover:text-solarized-base01 dark:hover:text-gray-200'
                          }`}
                      >
                        {hasUnread && <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0 animate-bounce" />}
                        <span className={`text-xs px-1.5 py-0.5 rounded ${DEPT_COLOR[ticket.dept] || 'bg-slate-100 text-slate-700'}`}>{ticket.dept}</span>
                        <span className="max-w-32 truncate">{ticket.agentName}</span>
                        {ticket.cdbId && <span className="text-xs font-mono text-solarized-base1">#{ticket.cdbId}</span>}
                        {ticket.dareRef && <span className="text-xs font-mono text-solarized-base1">{ticket.dareRef}</span>}
                        <span
                          onClick={(e) => { e.stopPropagation(); closeTab(ticket.id); }}
                          className="ml-1 text-solarized-base1 hover:text-solarized-base01 text-base leading-none"
                        >×</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {(viewMode === 'split' || viewMode === 'vsplit') && (
                <div className="flex-1 px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
                  {openTabTickets.length} {openTabTickets.length === 1 ? t('chat') : t('active_tickets')}
                  {openTabTickets.length < 4 && <span className="ml-2 text-solarized-base1">· {t('max_chats_hint')}</span>}
                </div>
              )}

              {/* View toggle */}
              <div className="flex items-center gap-1 px-3 border-l border-solarized-base2 dark:border-brand-700 shrink-0">
                <button
                  onClick={() => setViewMode('tabs')}
                  title={t('tab_view')}
                  className={`p-1.5 rounded-md transition-colors ${viewMode === 'tabs' ? 'bg-solarized-base2 dark:bg-brand-900/30 text-brand-600' : 'text-solarized-base1 hover:text-solarized-base01 hover:bg-solarized-base2 dark:hover:bg-brand-700'}`}
                >
                  <TabIcon />
                </button>
                <button
                  onClick={() => setViewMode('vsplit')}
                  title={t('vertical_split')}
                  className={`p-1.5 rounded-md transition-colors ${viewMode === 'vsplit' ? 'bg-solarized-base2 dark:bg-brand-900/30 text-brand-600' : 'text-solarized-base1 hover:text-solarized-base01 hover:bg-solarized-base2 dark:hover:bg-brand-700'}`}
                >
                  <VSplitIcon />
                </button>
                <button
                  onClick={() => setViewMode('split')}
                  title={t('grid_split')}
                  className={`p-1.5 rounded-md transition-colors ${viewMode === 'split' ? 'bg-solarized-base2 dark:bg-brand-900/30 text-brand-600' : 'text-solarized-base1 hover:text-solarized-base01 hover:bg-solarized-base2 dark:hover:bg-brand-700'}`}
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
                onJoin={() => joinTicket(previewTicket!)}
                onClose={() => setPreviewTicketId(null)}
                joinDisabled={atMaxChats}
              />
            ) : openTabTickets.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-solarized-base1 p-4">
                <div className="w-16 h-16 bg-solarized-base2 dark:bg-brand-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                  </svg>
                </div>
                <p className="text-lg font-medium text-solarized-base01 dark:text-gray-400">{t('ready_to_help')}</p>
                <p className="text-sm mt-1">{t('select_ticket_hint')}</p>
              </div>
            ) : viewMode === 'tabs' ? (
              <div className="h-full p-4">
                {(() => {
                  const ticket = tickets.find((tk) => tk.id === activeTab) || openTabTickets[0];
                  return ticket
                    ? (
                      <motion.div layout layoutId={`chat-container-${ticket.id}`} className="h-full">
                        <ChatWindow key={ticket.id} ticket={ticket} onClose={() => closeTab(ticket.id)} />
                      </motion.div>
                    )
                    : null;
                })()}
              </div>
            ) : (
              focusedTicketId && openTabTickets.find((tk) => tk.id === focusedTicketId) ? (
                <div className="h-full flex flex-col">
                  {/* Floating mini-tabs bar */}
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
                            <span className={`text-[10px] px-1 py-0.5 rounded ${DEPT_COLOR[tk.dept] || 'bg-slate-100 text-slate-700'}`}>{tk.dept}</span>
                            <span className="max-w-20 truncate">{tk.agentName}</span>
                            {hasUnread && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => setFocusedTicketId(null)}
                        className="ml-auto text-xs text-solarized-base1 hover:text-solarized-base01 dark:hover:text-gray-200 px-2 py-1 rounded hover:bg-solarized-base2 dark:hover:bg-gray-600 transition-colors"
                      >
                        {t('show_all')}
                      </button>
                    </div>
                  )}


                  <div className="flex-1 min-h-0 p-2">
                    <ChatWindow
                      key={focusedTicketId}
                      ticket={focusedTicketId ? openTabTickets.find((tk) => tk.id === focusedTicketId) : undefined}
                      onClose={() => focusedTicketId && closeTab(focusedTicketId)}
                      onFocus={() => setFocusedTicketId(null)}
                      focused
                    />
                  </div>
                </div>
              ) : (
                <motion.div layout className={`h-full grid gap-2 p-2 ${viewMode === 'vsplit' ? vsplitGridClass(openTabTickets.length) : splitGridClass(openTabTickets.length)} ${focusMode ? 'focus-dim' : ''}`}>
                  {openTabTickets.map((ticket) => (
                    <motion.div 
                      layout
                      layoutId={`chat-container-${ticket.id}`}
                      key={ticket.id} 
                      className={`min-h-0 overflow-hidden transition-all duration-500 ${
                        focusMode && focusedTicketId && focusedTicketId !== ticket.id ? 'opacity-30 grayscale-[0.5] scale-[0.98] blur-[1px]' : 'opacity-100'
                      }`}
                    >
                      <ChatWindow
                        ticket={ticket}
                        onClose={() => closeTab(ticket.id)}
                        onFocus={() => setFocusedTicketId(ticket.id)}
                      />
                    </motion.div>
                  ))}
                </motion.div>
              )
            )}
          </div>
        </main>
      </motion.div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
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
import InWebsiteError from '../components/InWebsiteError';
import { requestNotificationPermission } from '../utils/notifications';
import { Ticket } from '../types';
import { getTicketTime } from '../utils/dateUtils';
import { trpc } from '../utils/trpc';

const DEPT_COLOR: Record<string, string> = {
  DSC: 'border-black dark:border-white bg-black dark:bg-white text-white dark:text-black',
  FOT: 'border-black dark:border-white bg-white dark:bg-black text-black dark:text-white',
};

interface StatusOption {
  key: string;
  label: string;
  dot: string;
}

const STATUSES: StatusOption[] = [
  { key: 'available', label: 'status_available', dot: 'bg-black dark:bg-white' },
  { key: 'break', label: 'status_break', dot: 'bg-slate-400' },
  { key: 'lunch', label: 'status_lunch', dot: 'bg-slate-400' },
  { key: 'meeting', label: 'status_meeting', dot: 'bg-slate-400' },
  { key: 'training', label: 'status_training', dot: 'bg-slate-400' },
];

function statusDot(status: string) {
  return STATUSES.find((s) => s.key === status)?.dot || 'bg-black dark:bg-white';
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
        aria-label={`Status: ${t(current.label)}`}
        aria-expanded={open}
        className="flex items-center gap-2 bg-white dark:bg-black border border-black dark:border-white px-2.5 py-1.5 transition-colors group hover:bg-black dark:hover:bg-white"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${current.dot} group-hover:invert`} />
        <span className="text-[10px] font-black uppercase text-black dark:text-white group-hover:text-white dark:group-hover:text-black">{t(current.label)}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-black border-2 border-black dark:border-white z-50">
          {STATUSES.map((s) => (
            <button
              key={s.key}
              onClick={() => { onChange(s.key); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-[10px] font-black uppercase ${s.key === value ? 'bg-black dark:bg-white text-white dark:text-black' : 'text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/5'
                }`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
              {t(s.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BellIcon({ muted }: { muted: boolean }) {
  return (
    <div className="w-5 h-5 flex items-center justify-center font-black">
      {muted ? 'M' : 'B'}
    </div>
  );
}

export default function SupportView() {
  const { user, tickets, setTickets, supportOpenTickets, addSupportOpenTicket, removeSupportOpenTicket, logout, unreadTickets, clearUnread, setAllLabels, setCannedResponses, focusMode, toggleFocusMode, activePartnerId, memberships, activeMembershipId, onlineSupportUsers } = useStore();
  const t = useT();
  const [myStatus, setMyStatus] = useState('available');
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [filterDept, setFilterDept] = useState('all');
  const notificationsEnabled = useStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useStore((s) => s.setNotificationsEnabled);
  const [previewTicketId, setPreviewTicketId] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'queue' | 'archive'>('queue');
  const [archivedTickets, setArchivedTickets] = useState<Ticket[]>([]);
  const [archiveTotal, setArchiveTotal] = useState(0);
  const [archiveOffset, setArchiveOffset] = useState(0);
  const [archiveSearch, setArchiveSearch] = useState('');
  const [archiveDept, setArchiveDept] = useState('all');
  const [toast, setToast] = useState<string | null>(null);
  const ARCHIVE_LIMIT = ARCHIVE_PAGE_SIZE;

  const activeMembership = memberships.find(m => m.id === activeMembershipId);
  const partnerName = activeMembership?.partnerName || 'Tessera';

  useEffect(() => {
    if (notificationsEnabled) requestNotificationPermission();
  }, [notificationsEnabled]);

  const archiveQuery = trpc.ticket.list.useQuery(
    {
      status: 'closed',
      limit: ARCHIVE_LIMIT,
      offset: archiveOffset,
      dept: archiveDept === 'all' ? undefined : archiveDept,
      search: archiveSearch.trim() || undefined,
    },
    { enabled: sidebarTab === 'archive' }
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

  const queueFiltered = (filterDept === 'all' ? tickets : tickets.filter((tk) => tk.dept === filterDept)).filter(tk => tk.status !== 'closed');
  const openTabTickets = supportOpenTickets.map((id) => tickets.find((tk) => tk.id === id)).filter((tk): tk is Ticket => !!tk);
  const previewTicket = previewTicketId ? (tickets.find((tk) => tk.id === previewTicketId) || archivedTickets.find((tk) => tk.id === previewTicketId)) : null;
  const showPreview = !!previewTicket && !supportOpenTickets.includes(previewTicketId!);
  const atMaxChats = openTabTickets.length >= MAX_OPEN_CHATS;

  function selectTicket(ticket: Ticket) {
    if (!user) return;
    if (supportOpenTickets.includes(ticket.id)) {
      setActiveTab(ticket.id);
      clearUnread(ticket.id);
      setPreviewTicketId(null);
    } else if (!atMaxChats) {
      setPreviewTicketId(ticket.id);
    }
  }

  function joinTicket(ticket: Ticket) {
    if (!user || atMaxChats) return;
    getSocket().emit('support:join', { ticketId: ticket.id, supportId: user.id, supportName: user.name, supportLang: user.lang });
    addSupportOpenTicket(ticket.id);
    setActiveTab(ticket.id);
    clearUnread(ticket.id);
    setPreviewTicketId(null);
  }

  if (!user) return null;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white dark:bg-black text-black dark:text-white">
      <nav className={`px-8 flex items-center justify-between sticky top-0 z-50 border-b-2 border-black dark:border-white ${focusMode ? 'py-2 bg-black text-white' : 'py-4 bg-white dark:bg-black'}`}>
        <div className="flex items-center gap-4">
          <span className="font-black text-2xl uppercase tracking-tighter">TESSERA</span>
          {!focusMode && <span className="text-[10px] font-black px-3 py-1 uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black">{partnerName}</span>}
        </div>
        <div className="flex items-center gap-6">
          {!focusMode && (
            <div className="flex items-center gap-2 px-4 py-1.5 border-2 border-black dark:border-white bg-white dark:bg-black font-black uppercase text-[10px]">
              {user.name}
            </div>
          )}
          <StatusPicker value={myStatus} onChange={setMyStatus} />
          <div className="flex items-center gap-1.5 bg-black dark:bg-white p-1 ml-2 border border-black dark:border-white">
            <button onClick={toggleFocusMode} className={`w-8 h-8 flex items-center justify-center ${focusMode ? 'bg-white text-black invert' : 'text-white dark:text-black hover:bg-white dark:hover:bg-black hover:text-black dark:hover:text-white'}`}>Z</button>
            <NeuroToggle />
            <DarkModeToggle />
            <button onClick={() => setNotificationsEnabled(!notificationsEnabled)} className={`w-8 h-8 flex items-center justify-center ${notificationsEnabled ? 'bg-white text-black invert' : 'text-slate-400'}`}><BellIcon muted={!notificationsEnabled} /></button>
          </div>
          <button onClick={logout} className="text-black dark:text-white hover:line-through text-xs font-black uppercase tracking-widest">{t('sign_out')}</button>
        </div>
      </nav>

      <div className="flex flex-1 overflow-hidden">
        {!focusMode && (
          <aside className="w-80 bg-white dark:bg-black border-r-2 border-black dark:border-white flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b-2 border-black dark:border-white">
              <h2 className="font-black text-[10px] uppercase tracking-[0.2em] mb-2">{sidebarTab === 'queue' ? t('queue') : t('archive')}</h2>
              <div className="flex gap-1">
                <button onClick={() => setSidebarTab('queue')} className={`flex-1 text-[9px] font-black uppercase py-1 border ${sidebarTab === 'queue' ? 'bg-black dark:bg-white text-white dark:text-black' : ''}`}>Queue</button>
                <button onClick={() => setSidebarTab('archive')} className={`flex-1 text-[9px] font-black uppercase py-1 border ${sidebarTab === 'archive' ? 'bg-black dark:bg-white text-white dark:text-black' : ''}`}>Archive</button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto">
              <ul className="divide-y-2 divide-black dark:divide-white">
                {sidebarTab === 'queue' ? (
                  queueFiltered.map((ticket) => (
                    <li key={ticket.id} onClick={() => selectTicket(ticket)} className={`p-4 cursor-pointer ${activeTab === ticket.id ? 'bg-black dark:bg-white text-white dark:text-black' : 'hover:bg-black/5'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[9px] font-black px-1.5 py-0.5 border border-current uppercase">{ticket.dept}</span>
                        <span className="text-[9px] opacity-60 uppercase">{getTicketTime(ticket.createdAt)}</span>
                      </div>
                      <p className="text-sm font-black uppercase truncate">{ticket.agentName}</p>
                    </li>
                  ))
                ) : (
                  archivedTickets.map((ticket) => (
                    <li key={ticket.id} onClick={() => setPreviewTicketId(ticket.id)} className={`p-4 cursor-pointer ${previewTicketId === ticket.id ? 'bg-black dark:bg-white text-white dark:text-black' : 'hover:bg-black/5'}`}>
                      <p className="text-sm font-black uppercase truncate">{ticket.agentName}</p>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </aside>
        )}

        <main className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-black">
          {openTabTickets.length > 0 && (
            <div className="flex border-b-2 border-black dark:border-white overflow-x-auto">
              {openTabTickets.map((ticket) => (
                <button
                  key={ticket.id}
                  onClick={() => setActiveTab(ticket.id)}
                  className={`px-6 py-3 text-[10px] font-black uppercase tracking-widest border-r-2 border-black dark:border-white ${activeTab === ticket.id ? 'bg-black dark:bg-white text-white dark:text-black' : ''}`}
                >
                  {ticket.agentName}
                  <span onClick={(e) => { e.stopPropagation(); removeSupportOpenTicket(ticket.id); }} className="ml-2">×</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            {showPreview ? (
              <TicketPreview ticket={previewTicket} messages={[]} onJoin={() => joinTicket(previewTicket!)} onClose={() => setPreviewTicketId(null)} />
            ) : activeTab ? (
              <ChatWindow ticket={tickets.find(t => t.id === activeTab)} onClose={() => removeSupportOpenTicket(activeTab!)} />
            ) : (
              <div className="h-full flex items-center justify-center font-black uppercase tracking-[0.2em] opacity-20 text-2xl">Ready to help</div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

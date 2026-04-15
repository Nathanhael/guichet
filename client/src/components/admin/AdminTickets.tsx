import { useEffect, useState, useMemo } from 'react';
import { useStoreShallow } from '../../store/useStore';
import { trpc } from '../../utils/trpc';
import ChatWindow from '../ChatWindow';
import TicketPreview from '../TicketPreview';
import { Ticket } from '../../types';
import { useT } from '../../i18n';
import { usePartner } from '../../hooks/usePartner';
import { Search, X } from 'lucide-react';

type TicketStatus = 'open' | 'pending' | 'closed' | 'resolved';

const STATUS_FILTERS: { value: TicketStatus[] | undefined; label: string }[] = [
  { value: ['open', 'pending'], label: 'Active' },
  { value: undefined, label: 'All' },
  { value: ['open'], label: 'Open' },
  { value: ['pending'], label: 'Pending' },
  { value: ['closed'], label: 'Closed' },
  { value: ['resolved'], label: 'Resolved' },
];

const TICKET_STATUS_COLORS: Record<string, string> = {
  open: 'bg-[var(--color-accent-blue)]',
  pending: 'bg-[var(--color-accent-amber)]',
  closed: 'bg-[var(--color-text-muted)]',
  resolved: 'bg-[var(--color-accent-green)]',
};

function useDebounce(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

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
  const { manifest } = usePartner();
  const departments = manifest.departments || [];

  // Filter state
  const [statusFilter, setStatusFilter] = useState<TicketStatus[] | undefined>(['open', 'pending']);
  const [deptFilter, setDeptFilter] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [previewTicketId, setPreviewTicketId] = useState<string | null>(null);

  // Show date filters when viewing closed/resolved
  const showDateFilters = useMemo(() => {
    if (!statusFilter) return true; // "All" includes closed
    return statusFilter.some(s => s === 'closed' || s === 'resolved');
  }, [statusFilter]);

  // Only poll when viewing live statuses
  const isLiveView = useMemo(() => {
    if (!statusFilter) return false;
    return statusFilter.every(s => s === 'open' || s === 'pending');
  }, [statusFilter]);

  // tRPC: Ticket List
  const ticketsQuery = trpc.ticket.list.useQuery(
    {
      status: statusFilter,
      dept: deptFilter || undefined,
      search: debouncedSearch || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      limit: 50,
    },
    {
      refetchInterval: isLiveView ? 30000 : false,
    }
  );

  useEffect(() => {
    if (ticketsQuery.data && Array.isArray(ticketsQuery.data)) {
      setTickets(ticketsQuery.data as Ticket[]);
    }
  }, [ticketsQuery.data, setTickets]);

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

  const hasFilters = deptFilter || search || dateFrom || dateTo;

  return (
    <div className="flex h-full overflow-hidden bg-[var(--color-bg-base)]">
      {/* Sidebar */}
      <aside className="w-80 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-bg-surface)]">
        {/* Header */}
        <div className="p-3 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-secondary)]">
              {t('live_queue') || 'Ticket Queue'} ({tickets.length})
            </h2>
            {ticketsQuery.isFetching && (
              <div className="w-2 h-2 bg-[var(--color-accent-blue)] animate-pulse" />
            )}
          </div>

          {/* Status filter chips */}
          <div className="flex flex-wrap gap-1 mb-2">
            {STATUS_FILTERS.map(({ value, label }) => {
              const active = statusFilter === value || (statusFilter && value && JSON.stringify(statusFilter) === JSON.stringify(value));
              return (
                <button
                  key={label}
                  onClick={() => setStatusFilter(value)}
                  className={`px-2 py-1 text-[8px] font-bold uppercase tracking-wide border ${
                    active
                      ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)] border-[var(--color-text-primary)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Search */}
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--color-text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agent or support..."
              className="input-field w-full text-[10px] pl-7 py-1.5"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Department filter */}
          {departments.length > 0 && (
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="input-field w-full text-[10px] py-1.5 mb-2"
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}

          {/* Date range — only for closed/resolved */}
          {showDateFilters && (
            <div className="flex gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="input-field flex-1 text-[9px] py-1"
                title="From date"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="input-field flex-1 text-[9px] py-1"
                title="To date"
              />
            </div>
          )}

          {/* Clear filters */}
          {hasFilters && (
            <button
              onClick={() => { setDeptFilter(''); setSearch(''); setDateFrom(''); setDateTo(''); }}
              className="text-[8px] font-bold uppercase tracking-widest text-[var(--color-accent-blue)] mt-2 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Ticket list */}
        <div className="flex-1 overflow-y-auto">
          {tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-[var(--color-text-muted)] opacity-30">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H4a2 2 0 00-2 2v7m18 0a2 2 0 01-2 2H4a2 2 0 01-2-2m18 0l-5 5m-7-5l-5 5" />
              </svg>
              <p className="text-[9px] font-bold uppercase tracking-wider">{t('queue_empty') || 'No tickets found'}</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]/30">
              {tickets.map((tk) => (
                <button
                  key={tk.id}
                  onClick={() => handlePreview(tk)}
                  className={`w-full text-left px-4 py-3 relative group transition-colors ${
                    previewTicketId === tk.id
                      ? 'bg-[var(--color-accent-blue)] text-white'
                      : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.03] text-[var(--color-text-primary)]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      {/* Status dot */}
                      <span className={`w-1.5 h-1.5 shrink-0 ${TICKET_STATUS_COLORS[tk.status] || 'bg-[var(--color-text-muted)]'}`} />
                      <span className={`text-[8px] font-bold px-1.5 py-0.5 uppercase tracking-widest border ${
                        previewTicketId === tk.id ? 'bg-white/10 border-white/20' : 'bg-bg-elevated border-border'
                      }`}>
                        {tk.dept}
                      </span>
                      <span className={`text-[7px] font-bold uppercase tracking-widest ${
                        previewTicketId === tk.id ? 'text-white/50' : 'text-[var(--color-text-muted)]'
                      }`}>
                        {tk.status}
                      </span>
                    </div>
                    <span className={`text-[8px] font-mono tracking-tighter ${previewTicketId === tk.id ? 'text-white/60' : 'text-[var(--color-text-muted)]'}`}>
                      {tk.createdAt ? new Date(tk.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                  <p className="text-[11px] font-bold truncate pr-6">{tk.agentName}</p>
                  {tk.supportName && (
                    <div className={`flex items-center gap-1.5 mt-1 ${previewTicketId === tk.id ? 'text-white/70' : 'text-[var(--color-text-secondary)]'}`}>
                      <div className="w-1 h-1 bg-current" />
                      <p className="text-[9px] truncate font-medium">{tk.supportName}</p>
                    </div>
                  )}
                  {(tk.status === 'closed' || tk.status === 'resolved') && tk.closedAt && (
                    <p className={`text-[8px] font-mono mt-1 ${previewTicketId === tk.id ? 'text-white/40' : 'text-[var(--color-text-muted)] opacity-60'}`}>
                      Closed {new Date(tk.closedAt).toLocaleDateString()}
                    </p>
                  )}
                  {!!unreadTickets[tk.id] && (
                    <span className="absolute top-3 right-3 w-2 h-2 bg-[var(--color-text-primary)]" />
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
                  <span className={`w-1.5 h-1.5 ${activeTab === tk.id ? 'bg-[var(--color-accent-blue)]' : 'bg-current opacity-30'}`} />
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

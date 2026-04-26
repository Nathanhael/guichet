import { useEffect, useRef, useState, useMemo } from 'react';
import { useStoreShallow } from '../../store/useStore';
import { trpc } from '../../utils/trpc';
import ChatWindow from '../ChatWindow';
import TicketPreview from '../TicketPreview';
import TicketAuditDrawer from './TicketAuditDrawer';
import { Ticket } from '../../types';
import { useT, useLang } from '../../i18n';
import { usePartner } from '../../hooks/usePartner';
import { Search, X, Inbox, MessageSquare } from 'lucide-react';

type TicketStatus = 'open' | 'pending' | 'closed';

type QueueFilter = { key: 'all' | 'unassigned' | 'inChat'; label: string; hasSupport?: boolean };

const LIVE_STATUS: TicketStatus[] = ['open', 'pending'];

const QUEUE_FILTERS: QueueFilter[] = [
  { key: 'all', label: 'All' },
  { key: 'unassigned', label: 'Unassigned', hasSupport: false },
  { key: 'inChat', label: 'In chat', hasSupport: true },
];

const STATUS_DOT: Record<string, string> = {
  open: 'bg-[var(--color-accent)]',
  pending: 'bg-[var(--color-accent-amber)]',
  closed: 'bg-[var(--color-ink-muted)]',
};

const INPUT = 'w-full h-8 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[12px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';

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
  const viewerLang = useLang();
  const { manifest } = usePartner();
  const departments = manifest.departments || [];

  const [queueFilter, setQueueFilter] = useState<QueueFilter['key']>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [filterLang, setFilterLang] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [previewTicketId, setPreviewTicketId] = useState<string | null>(null);
  const [auditTicketId, setAuditTicketId] = useState<string | null>(null);

  const activeFilter = useMemo(
    () => QUEUE_FILTERS.find((f) => f.key === queueFilter) ?? QUEUE_FILTERS[0],
    [queueFilter]
  );

  const aiConfigQuery = trpc.partner.getAiConfig.useQuery(undefined, {
    staleTime: 60_000,
  });
  const translationEnabled = aiConfigQuery.data?.translation === true;

  const ticketsQuery = trpc.ticket.list.useQuery(
    {
      status: LIVE_STATUS,
      hasSupport: activeFilter.hasSupport,
      search: debouncedSearch || undefined,
      limit: 50,
    },
    {
      refetchInterval: 30000,
    }
  );

  useEffect(() => {
    const payload = ticketsQuery.data;
    if (!payload) return;
    const list = Array.isArray(payload) ? payload : payload.tickets;
    setTickets(list as Ticket[]);
  }, [ticketsQuery.data, setTickets]);

  const deptCounts = useMemo(() => {
    const open = tickets.filter((tk) => tk.status !== 'closed');
    const counts: Record<string, number> = { all: open.length };
    for (const tk of open) {
      counts[tk.dept] = (counts[tk.dept] || 0) + 1;
    }
    return counts;
  }, [tickets]);

  const langCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tk of tickets) {
      if (tk.status === 'closed') continue;
      if (deptFilter !== 'all' && tk.dept !== deptFilter) continue;
      if (!tk.agentLang) continue;
      counts.set(tk.agentLang, (counts.get(tk.agentLang) || 0) + 1);
    }
    return counts;
  }, [tickets, deptFilter]);
  const langTotal = useMemo(
    () => Array.from(langCounts.values()).reduce((a, b) => a + b, 0),
    [langCounts],
  );

  const didAutoDefaultLang = useRef(false);
  useEffect(() => {
    if (didAutoDefaultLang.current) return;
    if (aiConfigQuery.isLoading) return;
    if (langCounts.size < 2) return;
    if (!translationEnabled && langCounts.has(viewerLang)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilterLang(viewerLang);
    }
    didAutoDefaultLang.current = true;
  }, [aiConfigQuery.isLoading, translationEnabled, langCounts, viewerLang]);

  const filteredTickets = useMemo(
    () =>
      tickets.filter(
        (tk) =>
          (deptFilter === 'all' || tk.dept === deptFilter) &&
          (!filterLang || tk.agentLang === filterLang),
      ),
    [tickets, deptFilter, filterLang],
  );

  const atMaxChats = supportOpenTickets.length >= 4;

  const openTabTickets = supportOpenTickets
    .map((id: string) => tickets.find((tk: Ticket) => tk.id === id))
    .filter((tk: Ticket | undefined): tk is Ticket => !!tk)
    .slice(0, 4);

  // Keep activeTab pointing at a valid tab as the open-tab set changes
  // (closing, opening, reopening). Cross-render state dependency.
  useEffect(() => {
    if (openTabTickets.length > 0 && !activeTab) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const hasFilters = deptFilter !== 'all' || filterLang || search;

  const deptChipClass = (active: boolean) =>
    `shrink-0 inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-2.5 py-1 text-[11px] font-semibold border transition-colors ${
      active
        ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
        : 'border-[var(--color-border)] text-[var(--color-ink-soft)] hover:bg-[var(--color-hover)]'
    }`;

  return (
    <div className="flex h-full overflow-hidden bg-[var(--color-bg)]">
      {/* Sidebar */}
      <aside className="w-80 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-bg-surface)]">
        <div className="p-3 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">
              {t('live_queue') || 'Ticket Queue'} <span className="text-[var(--color-ink-soft)]">({filteredTickets.length})</span>
            </h2>
            {ticketsQuery.isFetching && (
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-[v2p-pulse_1.8s_ease-in-out_infinite]" />
            )}
          </div>

          {/* Queue filter chips — segmented pill */}
          <div className="inline-flex gap-1 p-1 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] mb-2">
            {QUEUE_FILTERS.map(({ key, label }) => {
              const active = queueFilter === key;
              return (
                <button
                  key={key}
                  onClick={() => setQueueFilter(key)}
                  className={`px-3 py-1 rounded-[var(--radius-pill)] text-[12px] font-medium transition-colors ${
                    active
                      ? 'bg-[var(--color-bg-surface)] text-[var(--color-ink)] shadow-[var(--shadow-soft)]'
                      : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Search */}
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-ink-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agent or support…"
              className={`${INPUT} pl-8`}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Department chips */}
          {departments.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap py-1">
              <button
                onClick={() => setDeptFilter('all')}
                className={deptChipClass(deptFilter === 'all')}
              >
                {t('all') || 'All'}
                <span className={`text-[10px] tabular-nums ${deptFilter === 'all' ? 'text-white/80' : 'text-[var(--color-accent)]'}`}>{deptCounts.all || 0}</span>
              </button>
              {departments.map((dept) => (
                <button
                  key={dept.id}
                  onClick={() => setDeptFilter(dept.id)}
                  title={dept.name}
                  className={deptChipClass(deptFilter === dept.id)}
                >
                  {dept.id}
                  <span className={`text-[10px] tabular-nums ${deptFilter === dept.id ? 'text-white/80' : 'text-[var(--color-accent)]'}`}>{deptCounts[dept.id] || 0}</span>
                </button>
              ))}
            </div>
          )}

          {/* Language chips */}
          {langCounts.size >= 2 && (
            <div className="flex items-center gap-1 flex-wrap pt-1.5 mt-2 border-t border-[var(--color-border)]">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] mr-1">
                {t('lang_label') || 'Lang'}
              </span>
              <button
                onClick={() => setFilterLang(null)}
                className={deptChipClass(filterLang === null)}
                title={translationEnabled
                  ? (t('lang_filter_all_translated') || 'Show all languages')
                  : (t('lang_filter_all_no_translation') || 'Show all — you may not speak some')}
              >
                {t('all') || 'All'}
                <span className={`text-[10px] tabular-nums ${filterLang === null ? 'text-white/80' : 'text-[var(--color-accent)]'}`}>{langTotal}</span>
              </button>
              {Array.from(langCounts.keys())
                .sort((a, b) => (a === viewerLang ? -1 : b === viewerLang ? 1 : a.localeCompare(b)))
                .map((lang) => (
                  <button
                    key={lang}
                    onClick={() => setFilterLang(filterLang === lang ? null : lang)}
                    className={deptChipClass(filterLang === lang)}
                    title={lang === viewerLang
                      ? (t('lang_filter_your_lang') || 'Your language')
                      : translationEnabled
                        ? `Filter to ${lang.toUpperCase()}`
                        : `${lang.toUpperCase()} — translation is off`}
                  >
                    {lang.toUpperCase()}
                    <span className={`text-[10px] tabular-nums ${filterLang === lang ? 'text-white/80' : 'text-[var(--color-accent)]'}`}>{langCounts.get(lang) || 0}</span>
                  </button>
                ))}
            </div>
          )}

          {hasFilters && (
            <button
              onClick={() => { setDeptFilter('all'); setFilterLang(null); setSearch(''); }}
              className="text-[12px] font-medium text-[var(--color-accent)] mt-2 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Ticket list */}
        <div className="flex-1 overflow-y-auto">
          {filteredTickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-[var(--color-ink-muted)]">
              <Inbox className="h-10 w-10 mb-2 opacity-40" strokeWidth={1.5} />
              <p className="text-[12px]">{t('queue_empty') || 'No tickets found'}</p>
            </div>
          ) : (
            <div>
              {filteredTickets.map((tk) => {
                const selected = previewTicketId === tk.id;
                return (
                  <button
                    key={tk.id}
                    onClick={() => handlePreview(tk)}
                    className={`w-full text-left px-4 py-3 relative group transition-colors border-b border-[var(--color-border)] last:border-b-0 ${
                      selected
                        ? 'bg-[var(--color-accent-soft)]'
                        : 'hover:bg-[var(--color-hover)]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[tk.status] || 'bg-[var(--color-ink-muted)]'}`} />
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] text-[var(--color-ink-soft)] truncate">
                          {tk.dept}
                        </span>
                        <span className="text-[11px] text-[var(--color-ink-muted)] capitalize">
                          {tk.status}
                        </span>
                      </div>
                      <span className="text-[11px] text-[var(--color-ink-muted)] tabular-nums shrink-0 ml-2">
                        {tk.createdAt ? new Date(tk.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                    <p className="text-[13px] font-medium text-[var(--color-ink)] truncate pr-6">{tk.agentName}</p>
                    {tk.supportName && (
                      <div className="flex items-center gap-1.5 mt-1 text-[var(--color-ink-soft)]">
                        <span className="w-1 h-1 rounded-full bg-current opacity-60" />
                        <p className="text-[12px] truncate">{tk.supportName}</p>
                      </div>
                    )}
                    {!!unreadTickets[tk.id] && (
                      <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-[var(--color-accent)] animate-[v2p-pulse_1.8s_ease-in-out_infinite]" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {/* Main Area */}
      <main className="flex-1 flex flex-col relative bg-[var(--color-bg)]">
        {previewTicketId ? (
          <div className="h-full flex flex-col overflow-hidden">
            <TicketPreview
              ticket={tickets.find((t) => t.id === previewTicketId)!}
              onJoin={() => joinOpenTicket(tickets.find((t) => t.id === previewTicketId)!)}
              onClose={() => setPreviewTicketId(null)}
              onViewAudit={() => setAuditTicketId(previewTicketId)}
            />
          </div>
        ) : openTabTickets.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-[var(--color-ink-muted)] px-6 text-center">
            <div className="w-16 h-16 rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] flex items-center justify-center mb-4">
              <MessageSquare className="h-8 w-8 text-[var(--color-ink-muted)] opacity-70" strokeWidth={1.5} />
            </div>
            <h3 className="text-[16px] font-semibold text-[var(--color-ink)]">{t('active_workspace') || 'Active Workspace'}</h3>
            <p className="text-[13px] mt-1.5 text-[var(--color-ink-muted)]">{t('select_ticket_hint') || 'Select a ticket from the queue to start'}</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Tab Bar */}
            <div className="flex bg-[var(--color-bg-surface)] px-2 border-b border-[var(--color-border)] min-h-[44px] gap-1 items-end">
              {openTabTickets.map((tk: Ticket) => {
                const active = activeTab === tk.id;
                return (
                  <button
                    key={tk.id}
                    onClick={() => setActiveTab(tk.id)}
                    className={`group flex items-center gap-2 px-3 py-2 text-[13px] font-medium relative min-w-[120px] max-w-[180px] rounded-t-[var(--radius-btn)] transition-colors ${
                      active
                        ? 'bg-[var(--color-bg)] text-[var(--color-ink)] shadow-[var(--shadow-soft)]'
                        : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-hover)]'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? 'bg-[var(--color-accent)]' : 'bg-current opacity-40'}`} />
                    <span className="truncate flex-1 text-left">{tk.agentName}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); closeTab(tk.id); }}
                      className="w-5 h-5 flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 hover:bg-[var(--color-hover)] transition-all"
                      aria-label={`Close ${tk.agentName}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                    {active && (
                      <div className="absolute top-0 left-2 right-2 h-0.5 rounded-full bg-[var(--color-accent)]" />
                    )}
                  </button>
                );
              })}
            </div>

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

      <TicketAuditDrawer
        ticketId={auditTicketId}
        ticketLabel={(auditTicketId && tickets.find((t) => t.id === auditTicketId)?.agentName) || undefined}
        onClose={() => setAuditTicketId(null)}
      />
    </div>
  );
}

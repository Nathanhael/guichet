import { useEffect, useMemo, useState } from 'react';
import { useT } from '../../i18n';
import useStore from '../../store/useStore';
import { getTicketTime } from '../../utils/dateUtils';
import { trpc } from '../../utils/trpc';
import { ARCHIVE_PAGE_SIZE } from '../../config';
import { Ticket, Membership, OnlineSupport } from '../../types';
import SlaIndicator from '../SlaIndicator';
import SentimentDot from '../SentimentDot';
import { getStatusColors, getStatusI18nKey } from '../../utils/statusColors';
import SavedViewPicker, { ViewFilters } from './SavedViewPicker';

interface QueueSidebarProps {
  activeMembership: Membership;
  activeTab: string | null;
  previewTicketId: string | null;
  atMaxChats: boolean;
  isOpen: boolean;
  onSelectTicket: (ticket: Ticket) => void;
  onPreviewArchived: (ticket: Ticket) => void;
}

/**
 * Left sidebar for SupportView.
 * Two tabs: Queue (open tickets) and Archive (closed tickets).
 * Department filter chips narrow both lists.
 */
export default function QueueSidebar({
  activeMembership,
  activeTab,
  previewTicketId,
  atMaxChats,
  isOpen,
  onSelectTicket,
  onPreviewArchived,
}: QueueSidebarProps) {
  const tickets = useStore((s) => s.tickets);
  const supportOpenTickets = useStore((s) => s.supportOpenTickets);
  const unreadTickets = useStore((s) => s.unreadTickets);
  const onlineSupportUsers = useStore((s) => s.onlineSupportUsers) as OnlineSupport[];
  const t = useT();

  const availableCount = onlineSupportUsers.filter((u) => u.status === 'available').length;
  const totalOnline = onlineSupportUsers.length;

  // Batch sentiment scores for open tickets
  const { data: sentimentMap } = trpc.ai.getTicketSentiments.useQuery(undefined, {
    refetchInterval: 60000,
  });

  const [sidebarTab, setSidebarTab] = useState<'queue' | 'archive' | 'search'>('queue');
  const [filterDept, setFilterDept] = useState('all');
  const [archivedTickets, setArchivedTickets] = useState<Ticket[]>([]);
  const [archiveCursor, setArchiveCursor] = useState<string | undefined>(undefined);
  const [hasMoreArchive, setHasMoreArchive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const { data: savedViews } = trpc.savedView.list.useQuery();

  function applyView(filters: ViewFilters) {
    if (filters.dept) setFilterDept(filters.dept);
    if (filters.tab) setSidebarTab(filters.tab);
  }

  useEffect(() => {
    if (savedViews) {
      const defaultView = savedViews.find(v => v.isDefault);
      if (defaultView) {
        const filters = defaultView.filters as Record<string, unknown>;
        if (filters.dept && typeof filters.dept === 'string') setFilterDept(filters.dept);
        if (filters.tab && typeof filters.tab === 'string') setSidebarTab(filters.tab as 'queue' | 'archive' | 'search');
      }
    }
  }, [savedViews]);

  const departments = (activeMembership.manifest?.departments || []) as { id: string; name: string }[];
  const assignedDepartmentIds = activeMembership.departments || [];
  const isGeneralist = assignedDepartmentIds.length === 0;
  const visibleDepartments = isGeneralist
    ? departments
    : departments.filter((d) => assignedDepartmentIds.includes(d.id));

  // Search query
  const searchResults = trpc.message.search.useQuery(
    { query: searchQuery, dept: filterDept === 'all' ? undefined : filterDept },
    { enabled: sidebarTab === 'search' && searchQuery.length >= 2 }
  );

  // Archive query — includes both closed and resolved tickets
  const archiveQuery = trpc.ticket.list.useQuery(
    {
      status: ['closed', 'resolved'],
      limit: ARCHIVE_PAGE_SIZE,
      cursor: archiveCursor,
      dept: filterDept === 'all' ? undefined : filterDept,
    },
    { enabled: sidebarTab === 'archive' },
  );

  useEffect(() => {
    if (archiveQuery.data) {
      const data = archiveQuery.data as { tickets?: Ticket[]; nextCursor?: string };
      if (data.tickets) {
        setArchivedTickets((prev) =>
          archiveCursor ? [...prev, ...data.tickets!] : data.tickets!
        );
        setHasMoreArchive(!!data.nextCursor);
      }
    }
  }, [archiveQuery.data, archiveCursor]);

  // Reset archived tickets when switching dept filter while on archive tab
  useEffect(() => {
    if (sidebarTab === 'archive') {
      setArchivedTickets([]);
      setArchiveCursor(undefined);
      setHasMoreArchive(false);
    }
  }, [filterDept, sidebarTab]);

  // Filter queue tickets
  const queueFiltered = useMemo(
    () =>
      tickets.filter(
        (tk) =>
          tk.status !== 'closed' && tk.status !== 'resolved' &&
          (filterDept === 'all' || tk.dept === filterDept) &&
          (isGeneralist || assignedDepartmentIds.includes(tk.dept)),
      ),
    [tickets, filterDept, isGeneralist, assignedDepartmentIds],
  );

  return (
    <aside className={`${
      isOpen ? 'w-80 border-r border-[var(--color-border)] max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40' : 'w-0 border-r-0'
    } shrink-0 overflow-hidden bg-[var(--color-bg-surface)] flex flex-col`}>
      {/* Header: tabs + dept chips */}
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <h2 className="mono-label">
            {sidebarTab === 'queue' ? t('queue') : sidebarTab === 'archive' ? t('archive') : (t('search') || 'Search')}
          </h2>
          <SavedViewPicker
            currentFilters={{ dept: filterDept, tab: sidebarTab }}
            onApply={applyView}
          />
        </div>

        <div className="flex gap-1 mb-2">
          {(['queue', 'archive', 'search'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setSidebarTab(tab)}
              className={`flex-1 text-[9px] font-bold uppercase py-1 border ${
                sidebarTab === tab
                  ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)] border-[var(--color-border)]'
                  : 'border-[var(--color-border)] opacity-50'
              }`}
            >
              {tab === 'search' ? (t('search') || 'Search') : t(tab)}
            </button>
          ))}
        </div>

        {/* Search input */}
        {sidebarTab === 'search' && (
          <input
            type="text"
            aria-label="Search tickets"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search_messages') || 'Search messages...'}
            className="input-field mb-1"
            autoFocus
          />
        )}

        {/* Department filter chips */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1">
          <button
            onClick={() => setFilterDept('all')}
            className={`shrink-0 px-3 py-1 text-[9px] font-bold uppercase border ${
              filterDept === 'all'
                ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)] border-[var(--color-border)]'
                : 'border-[var(--color-border)] opacity-50 hover:opacity-100'
            }`}
          >
            {t('all')}
          </button>
          {visibleDepartments.map((dept) => (
            <button
              key={dept.id}
              onClick={() => setFilterDept(dept.id)}
              className={`shrink-0 px-3 py-1 text-[9px] font-bold uppercase border ${
                filterDept === dept.id
                  ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)] border-[var(--color-border)]'
                  : 'border-[var(--color-border)] opacity-50 hover:opacity-100'
              }`}
            >
              {dept.name}
            </button>
          ))}
        </div>
      </div>

      {/* Ticket list */}
      <div className="flex-1 overflow-y-auto">
        {/* At max chats banner */}
        {atMaxChats && sidebarTab === 'queue' && (
          <div className="px-4 py-2 bg-[var(--color-bg-base)] text-[9px] font-bold uppercase tracking-wider text-center opacity-60">
            {t('max_chats_reached') || 'Maximum chats reached'}
          </div>
        )}

        <ul className="divide-y divide-[var(--color-border)]">
          {sidebarTab === 'search' ? (
            searchResults.isLoading ? (
              <li className="p-8 text-center">
                <svg className="h-5 w-5 mx-auto mb-2 opacity-30" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </li>
            ) : searchQuery.length < 2 ? (
              <li className="p-8 text-center">
                <p className="mono-label opacity-20">{t('type_to_search') || 'Type at least 2 characters'}</p>
              </li>
            ) : !searchResults.data?.length ? (
              <li className="p-8 text-center">
                <p className="mono-label opacity-20">{t('no_results') || 'No results'}</p>
              </li>
            ) : (searchResults.data || []).map((result: { messageId: string; ticketId: string; text: string | null; createdAt: string; ticketDept: string; ticketStatus: string; agentName: string | null; senderName: string | null }) => (
              <li
                key={result.messageId}
                onClick={() => {
                  // Find ticket and preview it
                  const tk = tickets.find(t => t.id === result.ticketId);
                  if (tk) {
                    if (supportOpenTickets.includes(tk.id)) {
                      onSelectTicket(tk);
                    } else {
                      onPreviewArchived(tk);
                    }
                  }
                }}
                className="p-3 cursor-pointer hover:bg-[var(--color-accent-blue)] hover:text-white"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-[8px] border border-[var(--color-accent-blue)] text-[var(--color-accent-blue)] px-1.5 py-0.5 uppercase">{result.ticketDept}</span>
                  <span className="text-[9px] font-bold truncate">{result.agentName}</span>
                  <span className={`text-[9px] uppercase ${result.ticketStatus === 'closed' ? 'opacity-40' : ''}`}>{result.ticketStatus}</span>
                </div>
                <p className="text-[11px] opacity-70 truncate">{result.text}</p>
                <span className="mono-timestamp">{result.senderName} · {getTicketTime(result.createdAt)}</span>
              </li>
            ))
          ) : sidebarTab === 'queue'
            ? queueFiltered.length === 0 ? (
                <li className="p-8 text-center">
                  <p className="mono-label opacity-20">{t('queue_empty') || 'Queue empty'}</p>
                </li>
              ) : queueFiltered.map((ticket) => {
                const isOpen = supportOpenTickets.includes(ticket.id);
                const isUnread = !!unreadTickets[ticket.id];

                return (
                  <li
                    key={ticket.id}
                    onClick={() => !atMaxChats || isOpen ? onSelectTicket(ticket) : undefined}
                    className={`surface-card cursor-pointer ${
                      activeTab === ticket.id
                        ? 'border-l-[3px] border-l-[var(--color-accent-blue)]'
                        : ''
                    } ${atMaxChats && !isOpen ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-[8px] border border-[var(--color-accent-blue)] text-[var(--color-accent-blue)] px-1.5 py-0.5 uppercase">
                        {ticket.dept}
                      </span>
                      <span className="mono-timestamp">{getTicketTime(ticket.createdAt)}</span>
                      {isUnread && <span className="w-2 h-2 bg-[var(--color-accent-blue)] rounded-full shrink-0" />}
                      {sentimentMap && sentimentMap[ticket.id] != null && (
                        <SentimentDot score={sentimentMap[ticket.id]} compact />
                      )}
                      {ticket.slaResponseDueAt && !ticket.supportJoinedAt && (
                        <SlaIndicator dueAt={ticket.slaResponseDueAt} breached={ticket.slaBreached} compact />
                      )}
                    </div>
                    <p className="text-sm font-bold uppercase truncate">{ticket.agentName}</p>
                  </li>
                );
              })
            : (
              <>
                {archiveQuery.isLoading && archivedTickets.length === 0 ? (
                  <li className="p-8 text-center">
                    <svg className="h-5 w-5 mx-auto mb-2 opacity-30" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <p className="mono-label opacity-20">{t('loading') || 'Loading...'}</p>
                  </li>
                ) : archivedTickets.length === 0 ? (
                  <li className="p-8 text-center">
                    <p className="mono-label opacity-20">{t('no_archived') || 'No archived tickets'}</p>
                  </li>
                ) : archivedTickets.map((ticket) => (
                  <li
                    key={ticket.id}
                    onClick={() => onPreviewArchived(ticket)}
                    className={`surface-card cursor-pointer ${
                      previewTicketId === ticket.id
                        ? 'border-l-[3px] border-l-[var(--color-accent-blue)]'
                        : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-[8px] border border-[var(--color-accent-blue)] text-[var(--color-accent-blue)] px-1.5 py-0.5 uppercase">
                        {ticket.dept}
                      </span>
                      <span className="mono-timestamp">{getTicketTime(ticket.createdAt)}</span>
                    </div>
                    <p className="text-sm font-bold uppercase truncate">{ticket.agentName}</p>
                  </li>
                ))}
                {/* Load more button */}
                {hasMoreArchive && (
                  <li className="p-3">
                    <button
                      onClick={() => {
                        const data = archiveQuery.data as { nextCursor?: string } | undefined;
                        if (data?.nextCursor) setArchiveCursor(data.nextCursor);
                      }}
                      disabled={archiveQuery.isFetching}
                      className="w-full py-2 text-[9px] font-bold uppercase tracking-wide border border-[var(--color-border)] hover:bg-[var(--color-accent-blue)] hover:text-white disabled:opacity-30"
                    >
                      {archiveQuery.isFetching ? (t('loading') || 'Loading...') : (t('load_more') || 'Load more')}
                    </button>
                  </li>
                )}
              </>
            )}
        </ul>
      </div>

      {/* Queue count footer */}
      {sidebarTab === 'queue' && (
        <div className="px-4 py-2 border-t border-[var(--color-border)] mono-label opacity-40 text-center">
          {queueFiltered.length} {t('in_queue') || 'in queue'}
        </div>
      )}

      {/* Online team status */}
      {onlineSupportUsers.length > 0 && (
        <div className="border-t border-border px-3 py-3">
          <div className="text-[9px] font-mono font-bold uppercase tracking-widest text-text-muted mb-2">
            {t('online_team')}
          </div>
          <div className="flex flex-col gap-1.5">
            {onlineSupportUsers.map((agent) => {
              const colors = getStatusColors(agent.status);
              return (
                <div key={agent.userId} className="flex items-center gap-2 px-1 py-0.5">
                  <div className="w-6 h-6 rounded-full bg-bg-elevated flex items-center justify-center text-[9px] font-bold text-text-primary shrink-0">
                    {agent.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold text-text-primary truncate">{agent.name}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                    <span className={`text-[9px] font-bold uppercase ${colors.text}`}>
                      {t(getStatusI18nKey(agent.status))}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-2 pt-2 border-t border-border">
            <span className="text-[9px] font-mono font-bold uppercase text-text-muted">{t('team_capacity')}</span>
            <span className="text-[11px] font-bold text-accent-green">{availableCount} / {totalOnline}</span>
          </div>
        </div>
      )}
    </aside>
  );
}

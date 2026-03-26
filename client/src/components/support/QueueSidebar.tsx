import { useEffect, useMemo, useState } from 'react';
import { useT } from '../../i18n';
import useStore from '../../store/useStore';
import { getTicketTime } from '../../utils/dateUtils';
import { trpc } from '../../utils/trpc';
import { ARCHIVE_PAGE_SIZE } from '../../config';
import { Ticket, Membership } from '../../types';
import SlaIndicator from '../SlaIndicator';
import SentimentDot from '../SentimentDot';

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
  const t = useT();

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

  // Archive query — uses the same filterDept so chips work for both tabs
  const archiveQuery = trpc.ticket.list.useQuery(
    {
      status: 'closed',
      limit: ARCHIVE_PAGE_SIZE,
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
        if (data.nextCursor) setArchiveCursor(data.nextCursor);
      }
    }
  }, [archiveQuery.data]);

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
          tk.status !== 'closed' &&
          (filterDept === 'all' || tk.dept === filterDept) &&
          (isGeneralist || assignedDepartmentIds.includes(tk.dept)),
      ),
    [tickets, filterDept, isGeneralist, assignedDepartmentIds],
  );

  return (
    <aside className={`${
      isOpen ? 'w-80 border-r-2 border-black dark:border-white max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-2xl' : 'w-0 border-r-0'
    } shrink-0 overflow-hidden transition-all duration-200 bg-white dark:bg-black flex flex-col`}>
      {/* Header: tabs + dept chips */}
      <div className="px-4 py-3 border-b-2 border-black dark:border-white">
        <h2 className="font-black text-[10px] uppercase tracking-[0.2em] mb-2">
          {sidebarTab === 'queue' ? t('queue') : t('archive')}
        </h2>

        <div className="flex gap-1 mb-2">
          {(['queue', 'archive', 'search'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setSidebarTab(tab)}
              className={`flex-1 text-[9px] font-black uppercase py-1 border ${
                sidebarTab === tab
                  ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white'
                  : 'border-black/10'
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
            className="w-full px-3 py-1.5 text-xs border-2 border-black dark:border-white bg-transparent font-bold placeholder:font-normal mb-1"
            autoFocus
          />
        )}

        {/* Department filter chips */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1">
          <button
            onClick={() => setFilterDept('all')}
            className={`shrink-0 px-3 py-1 text-[9px] font-black uppercase border ${
              filterDept === 'all'
                ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white'
                : 'bg-white dark:bg-black text-black dark:text-white border-black/10 dark:border-white/10'
            }`}
          >
            {t('all')}
          </button>
          {visibleDepartments.map((dept) => (
            <button
              key={dept.id}
              onClick={() => setFilterDept(dept.id)}
              className={`shrink-0 px-3 py-1 text-[9px] font-black uppercase border ${
                filterDept === dept.id
                  ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white'
                  : 'bg-white dark:bg-black text-black dark:text-white border-black/10 dark:border-white/10'
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
          <div className="px-4 py-2 bg-black/5 dark:bg-white/5 text-[9px] font-black uppercase tracking-wider text-center opacity-60">
            {t('max_chats_reached') || 'Maximum chats reached'}
          </div>
        )}

        <ul className="divide-y-2 divide-black dark:divide-white">
          {sidebarTab === 'search' ? (
            searchResults.isLoading ? (
              <li className="p-8 text-center">
                <svg className="animate-spin h-5 w-5 mx-auto mb-2 opacity-30" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </li>
            ) : searchQuery.length < 2 ? (
              <li className="p-8 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest opacity-20">{t('type_to_search') || 'Type at least 2 characters'}</p>
              </li>
            ) : !searchResults.data?.length ? (
              <li className="p-8 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest opacity-20">{t('no_results') || 'No results'}</p>
              </li>
            ) : (searchResults.data || []).map((result: any) => (
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
                className="p-3 cursor-pointer hover:bg-black/5"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[9px] font-black px-1.5 py-0.5 border border-current uppercase">{result.ticketDept}</span>
                  <span className="text-[9px] font-bold truncate">{result.agentName}</span>
                  <span className={`text-[9px] uppercase ${result.ticketStatus === 'closed' ? 'opacity-40' : ''}`}>{result.ticketStatus}</span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate">{result.text}</p>
                <span className="text-[9px] opacity-40">{result.senderName} · {getTicketTime(result.createdAt)}</span>
              </li>
            ))
          ) : sidebarTab === 'queue'
            ? queueFiltered.length === 0 ? (
                <li className="p-8 text-center">
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-20">{t('queue_empty') || 'Queue empty'}</p>
                </li>
              ) : queueFiltered.map((ticket) => {
                const isOpen = supportOpenTickets.includes(ticket.id);
                const isUnread = unreadTickets.has(ticket.id);

                return (
                  <li
                    key={ticket.id}
                    onClick={() => !atMaxChats || isOpen ? onSelectTicket(ticket) : undefined}
                    className={`p-4 cursor-pointer ${
                      activeTab === ticket.id
                        ? 'bg-black dark:bg-white text-white dark:text-black'
                        : 'hover:bg-black/5'
                    } ${atMaxChats && !isOpen ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] font-black px-1.5 py-0.5 border border-current uppercase">
                        {ticket.dept}
                      </span>
                      <span className="text-[9px] opacity-60 uppercase">{getTicketTime(ticket.createdAt)}</span>
                      {isUnread && <span className="w-2 h-2 bg-black dark:bg-white rounded-full shrink-0" />}
                      {sentimentMap && sentimentMap[ticket.id] != null && (
                        <SentimentDot score={sentimentMap[ticket.id]} compact />
                      )}
                      {ticket.slaResponseDueAt && !ticket.supportJoinedAt && (
                        <SlaIndicator dueAt={ticket.slaResponseDueAt} breached={ticket.slaBreached} compact />
                      )}
                    </div>
                    <p className="text-sm font-black uppercase truncate">{ticket.agentName}</p>
                  </li>
                );
              })
            : (
              <>
                {archiveQuery.isLoading && archivedTickets.length === 0 ? (
                  <li className="p-8 text-center">
                    <svg className="animate-spin h-5 w-5 mx-auto mb-2 opacity-30" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <p className="text-[10px] font-black uppercase tracking-widest opacity-20">{t('loading') || 'Loading...'}</p>
                  </li>
                ) : archivedTickets.length === 0 ? (
                  <li className="p-8 text-center">
                    <p className="text-[10px] font-black uppercase tracking-widest opacity-20">{t('no_archived') || 'No archived tickets'}</p>
                  </li>
                ) : archivedTickets.map((ticket) => (
                  <li
                    key={ticket.id}
                    onClick={() => onPreviewArchived(ticket)}
                    className={`p-4 cursor-pointer ${
                      previewTicketId === ticket.id
                        ? 'bg-black dark:bg-white text-white dark:text-black'
                        : 'hover:bg-black/5'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] font-black px-1.5 py-0.5 border border-current uppercase">
                        {ticket.dept}
                      </span>
                      <span className="text-[9px] opacity-60 uppercase">{getTicketTime(ticket.createdAt)}</span>
                    </div>
                    <p className="text-sm font-black uppercase truncate">{ticket.agentName}</p>
                  </li>
                ))}
                {/* Load more button */}
                {hasMoreArchive && (
                  <li className="p-3">
                    <button
                      onClick={() => archiveQuery.refetch()}
                      disabled={archiveQuery.isFetching}
                      className="w-full py-2 text-[9px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black transition-all disabled:opacity-30"
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
        <div className="px-4 py-2 border-t-2 border-black dark:border-white text-[9px] font-black uppercase tracking-widest opacity-40 text-center">
          {queueFiltered.length} {t('in_queue') || 'in queue'}
        </div>
      )}
    </aside>
  );
}

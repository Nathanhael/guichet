import { useEffect, useMemo, useState } from 'react';
import { Shield, ChevronLeft } from 'lucide-react';
import { useT } from '../../i18n';
import useStore from '../../store/useStore';
import { getTicketTime } from '../../utils/dateUtils';
import { trpc } from '../../utils/trpc';
import { ARCHIVE_PAGE_SIZE } from '../../config';
import { Ticket, Membership, OnlineSupport } from '../../types';
import QueueTicketRow from './QueueTicketRow';
import ArchiveTicketRow from './ArchiveTicketRow';
import SidebarFooter from './SidebarFooter';

interface QueueSidebarProps {
  activeMembership: Membership;
  activeTab: string | null;
  previewTicketId: string | null;
  atMaxChats: boolean;
  onToggle: () => void;
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
  onToggle,
  onSelectTicket,
  onPreviewArchived,
}: QueueSidebarProps) {
  const tickets = useStore((s) => s.tickets);
  const supportOpenTickets = useStore((s) => s.supportOpenTickets);
  const unreadTickets = useStore((s) => s.unreadTickets);
  const onlineSupportUsers = useStore((s) => s.onlineSupportUsers) as OnlineSupport[];
  const user = useStore((s) => s.user);
  const t = useT();

  const [sidebarTab, setSidebarTab] = useState<'queue' | 'archive'>('queue');
  const [filterDept, setFilterDept] = useState('all');
  const [archivedTickets, setArchivedTickets] = useState<Ticket[]>([]);
  const [archiveCursor, setArchiveCursor] = useState<string | undefined>(undefined);
  const [hasMoreArchive, setHasMoreArchive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const departments = (activeMembership.manifest?.departments || []) as { id: string; name: string }[];
  const assignedDepartmentIds = activeMembership.departments || [];
  // Per spec (CLAUDE.md): empty/null memberships.departments = generalist (sees all partner depts).
  const isGeneralist = assignedDepartmentIds.length === 0;
  const visibleDepartments = isGeneralist
    ? departments
    : departments.filter((d) => assignedDepartmentIds.includes(d.id));
  // Ticket-level dept gate: generalist → always true, scoped → only assigned depts
  const ticketDeptAllowed = (deptId: string) =>
    isGeneralist || assignedDepartmentIds.includes(deptId);

  // Search query
  const searchResults = trpc.message.search.useQuery(
    { query: searchQuery, dept: filterDept === 'all' ? undefined : filterDept },
    { enabled: sidebarTab === 'archive' && searchQuery.length >= 2 }
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

  // Reset accumulated archive state. Called inline from filter-chip handlers
  // and the sidebar-tab toggle. NOT placed in a useEffect because effect-based
  // resets race the populate effect: when tRPC returns cached data with an
  // unchanged reference (e.g. toggling queue→archive→queue→archive), the
  // populate effect's deps don't change so it never re-fires, and a reset
  // effect would clear the list with no follow-up populate to refill it.
  function resetArchive() {
    setArchivedTickets([]);
    setArchiveCursor(undefined);
    setHasMoreArchive(false);
  }

  // Populate from query data. Depends on sidebarTab so that toggling back to
  // archive re-runs the effect and fills from the cached query data even when
  // the data reference itself hasn't changed since last visit.
  useEffect(() => {
    if (sidebarTab !== 'archive') return;
    if (!archiveQuery.data) return;
    const data = archiveQuery.data as { tickets?: Ticket[]; nextCursor?: string };
    if (data.tickets) {
      setArchivedTickets((prev) =>
        archiveCursor ? [...prev, ...data.tickets!] : data.tickets!
      );
      setHasMoreArchive(!!data.nextCursor);
    }
  }, [archiveQuery.data, archiveCursor, sidebarTab]);

  // Per-department open ticket counts (for pill badges)
  const deptCounts = useMemo(() => {
    const open = tickets.filter(
      (tk) =>
        tk.status !== 'closed' && tk.status !== 'resolved' &&
        ticketDeptAllowed(tk.dept),
    );
    const counts: Record<string, number> = { all: open.length };
    for (const tk of open) {
      counts[tk.dept] = (counts[tk.dept] || 0) + 1;
    }
    return counts;
  }, [tickets, ticketDeptAllowed]);

  // Filter queue tickets
  const queueFiltered = useMemo(
    () =>
      tickets.filter(
        (tk) =>
          tk.status !== 'closed' && tk.status !== 'resolved' &&
          (filterDept === 'all' || tk.dept === filterDept) &&
          ticketDeptAllowed(tk.dept),
      ),
    [tickets, filterDept, ticketDeptAllowed],
  );

  return (
    <>
      {departments.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <Shield className="h-8 w-8 text-text-muted opacity-30 mb-4" />
          <p className="text-sm font-bold uppercase tracking-tight mb-2">No departments configured</p>
          <p className="text-[10px] uppercase tracking-widest text-text-muted opacity-60">Contact your administrator to configure partner departments.</p>
        </div>
      ) : (
      <>
      {/* Header: mode title + collapse chevron + dept chips.
          Archive was demoted — tab pills are gone. The current mode is shown
          as a title; the switcher now lives in the SidebarFooter as a
          compact accent-blue outline button next to the count. */}
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <h2 className="mono-label text-text-primary">
            {sidebarTab === 'queue' ? t('queue') : t('archive')}
          </h2>
          <button
            onClick={onToggle}
            title="Ctrl+B"
            aria-label="Collapse sidebar"
            className="shrink-0 w-7 h-[26px] flex items-center justify-center border border-[var(--color-border)] opacity-40 hover:opacity-100"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Department filter chips — 3-char dept codes (DSC/FOT/TEC)
            instead of full names, flex-wrap so no horizontal scrollbar. */}
        <div className="flex items-center gap-1 flex-wrap py-1">
          <button
            onClick={() => { setFilterDept('all'); setSearchQuery(''); resetArchive(); }}
            className={`shrink-0 px-2.5 py-1 text-[9px] font-bold uppercase border flex items-center gap-1.5 tracking-[0.1em] ${
              filterDept === 'all'
                ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)] border-[var(--color-border)]'
                : 'border-[var(--color-border)] opacity-50 hover:opacity-100'
            }`}
          >
            {t('all')}
            {sidebarTab === 'queue' && <span className="text-[8px] tabular-nums text-[var(--color-accent-blue)]">{deptCounts.all || 0}</span>}
          </button>
          {visibleDepartments.map((dept) => (
            <button
              key={dept.id}
              onClick={() => { setFilterDept(dept.id); setSearchQuery(''); resetArchive(); }}
              title={dept.name}
              className={`shrink-0 px-2.5 py-1 text-[9px] font-bold uppercase border flex items-center gap-1.5 tracking-[0.1em] ${
                filterDept === dept.id
                  ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)] border-[var(--color-border)]'
                  : 'border-[var(--color-border)] opacity-50 hover:opacity-100'
              }`}
            >
              {dept.id}
              {sidebarTab === 'queue' && <span className="text-[8px] tabular-nums text-[var(--color-accent-blue)]">{deptCounts[dept.id] || 0}</span>}
            </button>
          ))}
        </div>
      </div>

      {sidebarTab === 'archive' && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            aria-label="Search tickets"
            data-queue-search
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search_messages') || 'Search messages...'}
            className="flex-1 bg-[var(--color-bg-base)] border border-[var(--color-border)] px-2.5 py-1.5 font-mono text-[10px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:uppercase placeholder:text-[9px]"
          />
        </div>
      )}

      {/* Ticket list */}
      <div className="flex-1 overflow-y-auto">
        {/* At max chats banner */}
        {atMaxChats && sidebarTab === 'queue' && (
          <div className="px-4 py-2 bg-[var(--color-bg-base)] text-[9px] font-bold uppercase tracking-wider text-center opacity-60">
            {t('max_chats_reached') || 'Maximum chats reached'}
          </div>
        )}

        <ul className="divide-y divide-[var(--color-border)]">
          {sidebarTab === 'queue'
            ? (
              queueFiltered.length === 0 ? (
                <li className="p-8 text-center">
                  <p className="mono-label opacity-20">{t('queue_empty') || 'Queue empty'}</p>
                </li>
              ) : queueFiltered.map((ticket) => {
                const isOpen = supportOpenTickets.includes(ticket.id);
                const unreadCount = Number(unreadTickets[ticket.id]) || 0;

                return (
                  <QueueTicketRow
                    key={ticket.id}
                    ticket={ticket}
                    isActive={activeTab === ticket.id}
                    unreadCount={unreadCount}
                    currentUserId={user?.id || ''}
                    onClick={() => (!atMaxChats || isOpen ? onSelectTicket(ticket) : undefined)}
                    disabled={atMaxChats && !isOpen}
                  />
                );
              })
            )
            : sidebarTab === 'archive' && searchQuery.length >= 2 ? (
              searchResults.isLoading ? (
                <li className="p-8 text-center">
                  <svg className="h-5 w-5 mx-auto mb-2 opacity-30" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                </li>
              ) : !searchResults.data?.length ? (
                <li className="p-8 text-center">
                  <p className="mono-label opacity-20">{t('no_results') || 'No results'}</p>
                </li>
              ) : (searchResults.data || []).map((result: { messageId: string; ticketId: string; text: string | null; createdAt: string; ticketDept: string; ticketStatus: string; agentName: string | null; senderName: string | null }) => (
                <li
                  key={result.messageId}
                  onClick={() => {
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
            )
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
                  <ArchiveTicketRow
                    key={ticket.id}
                    ticket={ticket}
                    isActive={previewTicketId === ticket.id}
                    currentUserId={user?.id || ''}
                    onClick={() => onPreviewArchived(ticket)}
                  />
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

      <SidebarFooter
        sidebarTab={sidebarTab}
        onToggleMode={() => setSidebarTab(sidebarTab === 'queue' ? 'archive' : 'queue')}
        queueCount={sidebarTab === 'queue' ? queueFiltered.length : archivedTickets.length}
        onlineSupportUsers={onlineSupportUsers}
      />
      </>
      )}
    </>
  );
}

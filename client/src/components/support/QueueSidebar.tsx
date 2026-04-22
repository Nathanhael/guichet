import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Shield, ChevronLeft, Search } from 'lucide-react';
import { useT, useLang } from '../../i18n';
import useStore from '../../store/useStore';
import { getTicketTime } from '../../utils/dateUtils';
import { trpc } from '../../utils/trpc';
import { ARCHIVE_PAGE_SIZE } from '../../config';
import { Ticket, Membership, OnlineSupport } from '../../types';
import QueueTicketRow from './QueueTicketRow';
import ArchiveTicketRow from './ArchiveTicketRow';
import SidebarFooter from './SidebarFooter';
import SectionLabel from '../ui/SectionLabel';
import Pill from '../ui/Pill';
import { getSocket } from '../../hooks/useSocket';

interface QueueSidebarProps {
  activeMembership: Membership;
  activeTab: string | null;
  previewTicketId: string | null;
  atMaxChats: boolean;
  onToggle: () => void;
  onSelectTicket: (ticket: Ticket) => void;
  onPreviewArchived: (ticket: Ticket) => void;
}

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
  const viewerLang = useLang();

  const [sidebarTab, setSidebarTab] = useState<'queue' | 'archive'>('queue');
  const [filterDept, setFilterDept] = useState('all');
  const [filterLang, setFilterLang] = useState<string | null>(null);
  const [archivedTickets, setArchivedTickets] = useState<Ticket[]>([]);
  const [archiveCursor, setArchiveCursor] = useState<string | undefined>(undefined);
  const [hasMoreArchive, setHasMoreArchive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [otherAgentsExpanded, setOtherAgentsExpanded] = useState(false);

  const aiConfigQuery = trpc.partner.getAiConfig.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
  });
  const translationEnabled = aiConfigQuery.data?.translation === true;

  const departments = (activeMembership.manifest?.departments || []) as { id: string; name: string }[];
  const assignedDepartmentIds = activeMembership.departments || [];
  const isGeneralist = assignedDepartmentIds.length === 0;
  const visibleDepartments = isGeneralist
    ? departments
    : departments.filter((d) => assignedDepartmentIds.includes(d.id));
  const ticketDeptAllowed = useCallback(
    (deptId: string) => isGeneralist || assignedDepartmentIds.includes(deptId),
    [isGeneralist, assignedDepartmentIds],
  );

  const searchResults = trpc.message.search.useQuery(
    { query: searchQuery, dept: filterDept === 'all' ? undefined : filterDept },
    { enabled: sidebarTab === 'archive' && searchQuery.length >= 2 }
  );

  const archiveQuery = trpc.ticket.list.useQuery(
    {
      status: ['closed'],
      limit: ARCHIVE_PAGE_SIZE,
      cursor: archiveCursor,
      dept: filterDept === 'all' ? undefined : filterDept,
    },
    { enabled: sidebarTab === 'archive' },
  );

  const trpcUtils = trpc.useUtils();
  const { data: slaBreaches } = trpc.sla.listBreaches.useQuery({ status: 'active', limit: 100 });
  const breachedTicketIds = useMemo(
    () => new Set((slaBreaches?.items ?? []).map((b) => b.ticketId)),
    [slaBreaches],
  );
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onChange = () => { trpcUtils.sla.listBreaches.invalidate(); };
    socket.on('sla:breach', onChange);
    socket.on('sla:resolved', onChange);
    return () => {
      socket.off('sla:breach', onChange);
      socket.off('sla:resolved', onChange);
    };
  }, [trpcUtils]);

  function resetArchive() {
    setArchivedTickets([]);
    setArchiveCursor(undefined);
    setHasMoreArchive(false);
  }

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

  const deptCounts = useMemo(() => {
    const open = tickets.filter(
      (tk) =>
        tk.status !== 'closed' &&
        ticketDeptAllowed(tk.dept),
    );
    const counts: Record<string, number> = { all: open.length };
    for (const tk of open) {
      counts[tk.dept] = (counts[tk.dept] || 0) + 1;
    }
    return counts;
  }, [tickets, ticketDeptAllowed]);

  const queueLangCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tk of tickets) {
      if (tk.status === 'closed') continue;
      if (!ticketDeptAllowed(tk.dept)) continue;
      if (!tk.agentLang) continue;
      counts.set(tk.agentLang, (counts.get(tk.agentLang) || 0) + 1);
    }
    return counts;
  }, [tickets, ticketDeptAllowed]);
  const queueLangTotal = useMemo(
    () => Array.from(queueLangCounts.values()).reduce((a, b) => a + b, 0),
    [queueLangCounts],
  );

  const didAutoDefaultLang = useRef(false);
  useEffect(() => {
    if (didAutoDefaultLang.current) return;
    if (aiConfigQuery.isLoading) return;
    if (queueLangCounts.size < 2) return;
    if (!translationEnabled && queueLangCounts.has(viewerLang)) {
      setFilterLang(viewerLang);
    }
    didAutoDefaultLang.current = true;
  }, [aiConfigQuery.isLoading, translationEnabled, queueLangCounts, viewerLang]);

  const queueFiltered = useMemo(
    () =>
      tickets.filter(
        (tk) =>
          tk.status !== 'closed' &&
          (filterDept === 'all' || tk.dept === filterDept) &&
          (!filterLang || tk.agentLang === filterLang) &&
          ticketDeptAllowed(tk.dept),
      ),
    [tickets, filterDept, filterLang, ticketDeptAllowed],
  );

  const myChats = useMemo(
    () => queueFiltered.filter((tk) => supportOpenTickets.includes(tk.id)),
    [queueFiltered, supportOpenTickets],
  );
  const otherAgents = useMemo(
    () => queueFiltered.filter((tk) => !supportOpenTickets.includes(tk.id) && tk.supportId),
    [queueFiltered, supportOpenTickets],
  );
  const unassigned = useMemo(
    () => queueFiltered.filter((tk) => !tk.supportId),
    [queueFiltered],
  );

  const deptChipClass = (active: boolean) =>
    `shrink-0 inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-2.5 py-1 text-[11px] font-semibold border transition-colors ${
      active
        ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
        : 'border-[var(--color-border)] text-[var(--color-ink-soft)] hover:bg-[var(--color-hover)]'
    }`;

  return (
    <>
      {departments.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <Shield className="h-8 w-8 text-[var(--color-ink-muted)] opacity-40 mb-4" />
          <p className="text-[14px] font-semibold mb-2 text-[var(--color-ink)]">No departments configured</p>
          <p className="text-[12px] text-[var(--color-ink-muted)]">Contact your administrator to configure partner departments.</p>
        </div>
      ) : (
      <>
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <SectionLabel>
            {sidebarTab === 'queue' ? t('queue') : t('archive')}
          </SectionLabel>
          <button
            onClick={onToggle}
            title="Ctrl+B"
            aria-label="Collapse sidebar"
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-[var(--radius-btn)] border border-[var(--color-border)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-hover)] transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>

        <div className="flex items-center gap-1 flex-wrap py-1">
          <button
            onClick={() => { setFilterDept('all'); setSearchQuery(''); resetArchive(); }}
            className={deptChipClass(filterDept === 'all')}
          >
            {t('all')}
            {sidebarTab === 'queue' && (
              <span className={`text-[10px] tabular-nums ${filterDept === 'all' ? 'text-white/80' : 'text-[var(--color-accent)]'}`}>{deptCounts.all || 0}</span>
            )}
          </button>
          {visibleDepartments.map((dept) => (
            <button
              key={dept.id}
              onClick={() => { setFilterDept(dept.id); setSearchQuery(''); resetArchive(); }}
              title={dept.name}
              className={deptChipClass(filterDept === dept.id)}
            >
              {dept.id}
              {sidebarTab === 'queue' && (
                <span className={`text-[10px] tabular-nums ${filterDept === dept.id ? 'text-white/80' : 'text-[var(--color-accent)]'}`}>{deptCounts[dept.id] || 0}</span>
              )}
            </button>
          ))}
        </div>

        {sidebarTab === 'queue' && queueLangCounts.size >= 2 && (
          <div className="flex items-center gap-1 flex-wrap pt-1.5 mt-1 border-t border-[var(--color-border)]">
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
              {t('all')}
              <span className={`text-[10px] tabular-nums ${filterLang === null ? 'text-white/80' : 'text-[var(--color-accent)]'}`}>{queueLangTotal}</span>
            </button>
            {Array.from(queueLangCounts.keys())
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
                  <span className={`text-[10px] tabular-nums ${filterLang === lang ? 'text-white/80' : 'text-[var(--color-accent)]'}`}>{queueLangCounts.get(lang) || 0}</span>
                </button>
              ))}
          </div>
        )}
      </div>

      {sidebarTab === 'archive' && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)]">
          <Search className="h-3.5 w-3.5 text-[var(--color-ink-muted)] shrink-0" strokeWidth={2} />
          <input
            type="text"
            aria-label="Search tickets"
            data-queue-search
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search_messages') || 'Search messages…'}
            className="flex-1 rounded-[var(--radius-btn)] bg-[var(--color-bg-base)] border border-[var(--color-border)] px-2.5 py-1.5 text-[12px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-accent)]"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <ul>
          {sidebarTab === 'queue'
            ? (
              queueFiltered.length === 0 ? (
                <li className="p-8 text-center">
                  <p className="text-[12px] text-[var(--color-ink-muted)]">{t('queue_empty') || 'Queue empty'}</p>
                </li>
              ) : (
                <>
                  {myChats.length > 0 && (
                    <>
                      <li className="px-3 pt-3 pb-1 flex items-center gap-1.5">
                        <SectionLabel className="text-[var(--color-accent)]">
                          {t('my_chats') || 'My chats'}
                        </SectionLabel>
                        <Pill tone="accent">{myChats.length}</Pill>
                      </li>
                      {myChats.map((ticket) => (
                        <QueueTicketRow
                          key={ticket.id}
                          ticket={ticket}
                          variant="mine"
                          isActive={activeTab === ticket.id}
                          unreadCount={Number(unreadTickets[ticket.id]) || 0}
                          currentUserId={user?.id || ''}
                          onClick={() => onSelectTicket(ticket)}
                          className={breachedTicketIds.has(ticket.id) ? 'border-l-4 border-l-[var(--color-urgent)]' : undefined}
                        />
                      ))}
                    </>
                  )}

                  {unassigned.length > 0 && (
                    <>
                      <li className="px-3 pt-3 pb-1 flex items-center gap-1.5">
                        <SectionLabel>
                          {t('queue') || 'Queue'}
                        </SectionLabel>
                        <Pill tone="muted">{unassigned.length}</Pill>
                      </li>
                      {unassigned.map((ticket) => (
                        <QueueTicketRow
                          key={ticket.id}
                          ticket={ticket}
                          variant="queue"
                          isActive={activeTab === ticket.id}
                          unreadCount={Number(unreadTickets[ticket.id]) || 0}
                          currentUserId={user?.id || ''}
                          onClick={() => (!atMaxChats ? onSelectTicket(ticket) : undefined)}
                          disabled={atMaxChats}
                          className={breachedTicketIds.has(ticket.id) ? 'border-l-4 border-l-[var(--color-urgent)]' : undefined}
                        />
                      ))}
                    </>
                  )}

                  {otherAgents.length > 0 && (
                    <>
                      <li
                        className="px-3 pt-3 pb-1 flex items-center gap-1.5 cursor-pointer hover:opacity-80"
                        onClick={() => setOtherAgentsExpanded((v) => !v)}
                      >
                        <SectionLabel>
                          {t('other_agents') || 'Other agents'}
                        </SectionLabel>
                        <Pill tone="muted">{otherAgents.length}</Pill>
                        <span className="text-[10px] text-[var(--color-ink-muted)] ml-auto">{otherAgentsExpanded ? '▴' : '▾'}</span>
                      </li>
                      {otherAgentsExpanded && otherAgents.map((ticket) => (
                        <QueueTicketRow
                          key={ticket.id}
                          ticket={ticket}
                          variant="other"
                          isActive={activeTab === ticket.id}
                          unreadCount={Number(unreadTickets[ticket.id]) || 0}
                          currentUserId={user?.id || ''}
                          onClick={() => (!atMaxChats ? onSelectTicket(ticket) : undefined)}
                          disabled={atMaxChats}
                          className={breachedTicketIds.has(ticket.id) ? 'border-l-4 border-l-[var(--color-urgent)]' : undefined}
                        />
                      ))}
                    </>
                  )}
                </>
              )
            )
            : sidebarTab === 'archive' && searchQuery.length >= 2 ? (
              searchResults.isLoading ? (
                <li className="p-8 text-center">
                  <svg className="h-5 w-5 mx-auto mb-2 opacity-30 animate-spin" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                </li>
              ) : !searchResults.data?.length ? (
                <li className="p-8 text-center">
                  <p className="text-[12px] text-[var(--color-ink-muted)]">{t('no_results') || 'No results'}</p>
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
                  className="p-3 cursor-pointer hover:bg-[var(--color-hover)] border-b border-[var(--color-border)]"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Pill tone="accent">{result.ticketDept}</Pill>
                    <span className="text-[12px] font-semibold text-[var(--color-ink)] truncate">{result.agentName}</span>
                    <span className={`text-[11px] text-[var(--color-ink-muted)] ${result.ticketStatus === 'closed' ? 'opacity-60' : ''}`}>{result.ticketStatus}</span>
                  </div>
                  <p className="text-[12px] text-[var(--color-ink-soft)] truncate mb-1">{result.text}</p>
                  <span className="text-[10px] text-[var(--color-ink-muted)]">{result.senderName} · {getTicketTime(result.createdAt)}</span>
                </li>
              ))
            )
            : (
              <>
                {archiveQuery.isLoading && archivedTickets.length === 0 ? (
                  <li className="p-8 text-center">
                    <svg className="h-5 w-5 mx-auto mb-2 opacity-30 animate-spin" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <p className="text-[12px] text-[var(--color-ink-muted)]">{t('loading') || 'Loading…'}</p>
                  </li>
                ) : archivedTickets.length === 0 ? (
                  <li className="p-8 text-center">
                    <p className="text-[12px] text-[var(--color-ink-muted)]">{t('no_archived') || 'No archived tickets'}</p>
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
                {hasMoreArchive && (
                  <li className="p-3">
                    <button
                      onClick={() => {
                        const data = archiveQuery.data as { nextCursor?: string } | undefined;
                        if (data?.nextCursor) setArchiveCursor(data.nextCursor);
                      }}
                      disabled={archiveQuery.isFetching}
                      className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-[12px] font-medium text-[var(--color-ink-soft)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {archiveQuery.isFetching ? (t('loading') || 'Loading…') : (t('load_more') || 'Load more')}
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

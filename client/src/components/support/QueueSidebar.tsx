import { useEffect, useMemo, useState } from 'react';
import { useT } from '../../i18n';
import useStore from '../../store/useStore';
import { getTicketTime } from '../../utils/dateUtils';
import { trpc } from '../../utils/trpc';
import { ARCHIVE_PAGE_SIZE } from '../../config';
import { Ticket, Membership } from '../../types';

interface QueueSidebarProps {
  activeMembership: Membership;
  activeTab: string | null;
  previewTicketId: string | null;
  atMaxChats: boolean;
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
  onSelectTicket,
  onPreviewArchived,
}: QueueSidebarProps) {
  const tickets = useStore((s) => s.tickets);
  const supportOpenTickets = useStore((s) => s.supportOpenTickets);
  const unreadTickets = useStore((s) => s.unreadTickets);
  const t = useT();

  const [sidebarTab, setSidebarTab] = useState<'queue' | 'archive'>('queue');
  const [filterDept, setFilterDept] = useState('all');
  const [archivedTickets, setArchivedTickets] = useState<Ticket[]>([]);

  const departments = (activeMembership.manifest?.departments || []) as { id: string; name: string }[];
  const assignedDepartmentIds = activeMembership.departments || [];
  const isGeneralist = assignedDepartmentIds.length === 0;
  const visibleDepartments = isGeneralist
    ? departments
    : departments.filter((d) => assignedDepartmentIds.includes(d.id));

  // Archive query — uses the same filterDept so chips work for both tabs
  const archiveQuery = trpc.ticket.list.useQuery(
    {
      status: 'closed',
      limit: ARCHIVE_PAGE_SIZE,
      offset: 0,
      dept: filterDept === 'all' ? undefined : filterDept,
    },
    { enabled: sidebarTab === 'archive' },
  );

  useEffect(() => {
    if (archiveQuery.data) {
      const data = archiveQuery.data as { tickets?: Ticket[]; total?: number };
      if (data.tickets) {
        setArchivedTickets(data.tickets);
      }
    }
  }, [archiveQuery.data]);

  // Reset archived tickets when switching dept filter while on archive tab
  useEffect(() => {
    if (sidebarTab === 'archive') {
      setArchivedTickets([]);
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
    <aside className="w-80 bg-white dark:bg-black border-r-2 border-black dark:border-white flex flex-col overflow-hidden">
      {/* Header: tabs + dept chips */}
      <div className="px-4 py-3 border-b-2 border-black dark:border-white">
        <h2 className="font-black text-[10px] uppercase tracking-[0.2em] mb-2">
          {sidebarTab === 'queue' ? t('queue') : t('archive')}
        </h2>

        <div className="flex gap-1 mb-2">
          <button
            onClick={() => setSidebarTab('queue')}
            className={`flex-1 text-[9px] font-black uppercase py-1 border ${
              sidebarTab === 'queue'
                ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white'
                : 'border-black/10'
            }`}
          >
            {t('queue')}
          </button>
          <button
            onClick={() => setSidebarTab('archive')}
            className={`flex-1 text-[9px] font-black uppercase py-1 border ${
              sidebarTab === 'archive'
                ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white'
                : 'border-black/10'
            }`}
          >
            {t('archive')}
          </button>
        </div>

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
        <ul className="divide-y-2 divide-black dark:divide-white">
          {sidebarTab === 'queue'
            ? queueFiltered.map((ticket) => {
                const isOpen = supportOpenTickets.includes(ticket.id);
                const isUnread = unreadTickets.has(ticket.id);

                return (
                  <li
                    key={ticket.id}
                    onClick={() => onSelectTicket(ticket)}
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
                    </div>
                    <p className="text-sm font-black uppercase truncate">{ticket.agentName}</p>
                  </li>
                );
              })
            : archivedTickets.map((ticket) => (
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
        </ul>
      </div>
    </aside>
  );
}

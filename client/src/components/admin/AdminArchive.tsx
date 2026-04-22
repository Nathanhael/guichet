import { useState, useEffect, useMemo } from 'react';
import { X, Download, Inbox } from 'lucide-react';
import { useT } from '../../i18n';
import { Ticket, Message } from '../../types';
import { trpc } from '../../utils/trpc';
import { usePartner } from '../../hooks/usePartner';

const LIMIT = 25;

const CARD = 'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)]';
const INPUT = 'h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';
const SELECT = 'h-9 pl-3 pr-8 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none cursor-pointer';
const COL_HEAD = 'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]';

export default function AdminArchive() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('all');
  const { manifest } = usePartner();
  const departments = manifest.departments || [];
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [preview, setPreview] = useState<Ticket | null>(null);
  const [previewMessages, setPreviewMessages] = useState<Message[]>([]);
  const [labelFilter, setLabelFilter] = useState('all');
  const [supportFilter, setSupportFilter] = useState<'all' | 'none' | string>('all');
  const t = useT();

  const { data: allLabels = [] } = trpc.label.list.useQuery();
  const { data: membersData } = trpc.partner.listMembers.useQuery({ role: 'support' }, { staleTime: 60_000 });
  const supportMembers = useMemo(
    () => (membersData ?? []).filter((m) => m.role === 'support'),
    [membersData],
  );

  const ticketsQuery = trpc.ticket.list.useQuery({
    status: ['closed'],
    limit: LIMIT,
    cursor,
    dept: dept === 'all' ? undefined : dept,
    search: search.trim() || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    hasSupport: supportFilter === 'none' ? false : undefined,
    supportId: supportFilter !== 'all' && supportFilter !== 'none' ? supportFilter : undefined,
  }, {
    refetchInterval: 60000,
  });

  // Cursor-paginated accumulator: merge each page of query results into local
  // state. setState-in-effect is the canonical pattern for this since the
  // accumulation is inherently cross-render and can't be a derived value.
  useEffect(() => {
    if (ticketsQuery.data) {
      const data = ticketsQuery.data as { tickets?: Ticket[]; nextCursor?: string };
      if (data.tickets) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTickets((prev) => !cursor ? data.tickets! : [...prev, ...data.tickets!]);
        setHasMore(!!data.nextCursor);
      }
    }
  }, [ticketsQuery.data, cursor]);

  const messagesQuery = trpc.message.list.useQuery(
    { ticketId: preview?.id || '' },
    { enabled: !!preview?.id }
  );

  // Sync fetched messages to local state for the preview pane.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (messagesQuery.data) setPreviewMessages(messagesQuery.data.messages as unknown as Message[]);
  }, [messagesQuery.data]);

  function resetPagination() {
    setCursor(undefined);
    setTickets([]);
    setHasMore(false);
  }

  function duration(tk: Ticket) {
    if (!tk.closedAt || !tk.createdAt) return '—';
    const m = Math.round((new Date(tk.closedAt).getTime() - new Date(tk.createdAt).getTime()) / 60000);
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  function fmt(iso?: string) {
    return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  }

  const loading = ticketsQuery.isFetching;

  const filteredTickets = tickets.filter((ticket) => {
    if (labelFilter === 'all') return true;
    if (labelFilter === 'none') return !ticket.labels || (ticket.labels as string[]).length === 0;
    if (labelFilter === 'any') return ticket.labels && (ticket.labels as string[]).length > 0;
    return ticket.labels && (ticket.labels as string[]).includes(labelFilter);
  });

  return (
    <div className="flex flex-col p-6 min-h-full overflow-x-hidden">
      <div className="flex-1 min-w-0">
        {/* Header + Filters */}
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <h2 className="text-[22px] font-semibold tracking-[-0.2px] text-[var(--color-ink)] mr-auto">Archive</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                const params = new URLSearchParams();
                if (dept !== 'all') params.set('dept', dept);
                if (search.trim()) params.set('search', search.trim());
                if (dateFrom) params.set('dateFrom', dateFrom);
                if (dateTo) params.set('dateTo', dateTo);
                window.open(`/api/v1/tickets/export?${params.toString()}`, '_blank');
              }}
              className="h-9 px-3 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[13px] font-medium text-[var(--color-ink)] transition-colors"
              title={t('export_csv')}
            >
              <Download className="h-3.5 w-3.5" />
              {t('export_csv')}
            </button>
            <div className="h-6 w-px bg-[var(--color-border)] mx-1" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); resetPagination(); }}
              placeholder={t('search') || 'Search…'}
              className={`${INPUT} w-44`}
            />
            <div className={`flex items-center gap-1.5 ${INPUT.replace('h-9 px-3', 'h-9 px-2')}`}>
              <input
                type="date"
                aria-label="Start date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); resetPagination(); }}
                className="bg-transparent text-[12px] outline-none text-[var(--color-ink)]"
              />
              <span className="text-[12px] text-[var(--color-ink-muted)]">→</span>
              <input
                type="date"
                aria-label="End date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); resetPagination(); }}
                className="bg-transparent text-[12px] outline-none text-[var(--color-ink)]"
              />
            </div>
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); resetPagination(); }}
                className="text-[12px] font-medium text-[var(--color-accent)] hover:underline px-1"
              >
                ✕ Clear
              </button>
            )}
            {departments.length > 0 && (
              <select
                value={dept}
                aria-label="Filter by department"
                onChange={(e) => { setDept(e.target.value); resetPagination(); }}
                className={SELECT}
              >
                <option value="all">All depts</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            {supportMembers.length > 0 && (
              <select
                value={supportFilter}
                aria-label="Filter by support agent"
                onChange={(e) => { setSupportFilter(e.target.value); resetPagination(); }}
                className={SELECT}
              >
                <option value="all">All support</option>
                <option value="none">Abandoned (no support)</option>
                {supportMembers.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
              </select>
            )}
            {allLabels.length > 0 && (
              <select
                value={labelFilter}
                onChange={(e) => setLabelFilter(e.target.value)}
                className={SELECT}
              >
                <option value="all">All labels</option>
                <option value="none">No label</option>
                <option value="any">Has label</option>
                {allLabels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* Table */}
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            {filteredTickets.length === 0 && !loading ? (
              <div className="flex flex-col items-center justify-center py-20 text-[var(--color-ink-muted)]">
                <Inbox className="h-10 w-10 opacity-50 mb-3" strokeWidth={1.5} />
                <p className="text-[13px]">No results.</p>
              </div>
            ) : (
              <table className="w-full text-[13px] border-collapse">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <th className={COL_HEAD}>Dept</th>
                    <th className={COL_HEAD}>Agent</th>
                    <th className={COL_HEAD}>Ref</th>
                    <th className={COL_HEAD}>Support</th>
                    <th className={COL_HEAD}>Labels</th>
                    <th className={COL_HEAD}>Duration</th>
                    <th className={COL_HEAD}>Created</th>
                    <th className={COL_HEAD}>Closed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {filteredTickets.map((ticket) => (
                    <tr
                      key={ticket.id}
                      onClick={() => setPreview(preview?.id === ticket.id ? null : ticket)}
                      className={`cursor-pointer transition-colors ${preview?.id === ticket.id ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-hover)]'}`}
                    >
                      <td className="px-4 py-3">
                        <span className="text-[11px] font-medium bg-[var(--color-bg-elevated)] text-[var(--color-ink-soft)] px-2 py-0.5 rounded-[var(--radius-pill)]">{ticket.dept}</span>
                      </td>
                      <td className="px-4 py-3 font-medium text-[var(--color-ink)]">{ticket.agentName}</td>
                      <td className="px-4 py-3 text-[12px] text-[var(--color-ink-muted)]">
                        {(ticket.references as Array<{label: string; value: string}> || []).length > 0
                          ? (ticket.references as Array<{label: string; value: string}> || []).map((ref) => (
                              <span key={ref.label} className="mr-3 whitespace-nowrap">
                                <span className="text-[var(--color-ink-muted)]">{ref.label}:</span>{' '}
                                <span className="font-mono text-[var(--color-ink)]">{ref.value}</span>
                              </span>
                            ))
                          : <span className="text-[var(--color-ink-muted)] opacity-50">—</span>}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-[var(--color-ink-soft)]">
                        {ticket.supportName || <span className="italic text-[var(--color-ink-muted)]">Abandoned</span>}
                      </td>
                      <td className="px-4 py-3">
                        {ticket.labels && (ticket.labels as string[]).length > 0 ? (
                          <div className="flex gap-1 flex-wrap">
                            {(ticket.labels as string[]).map((id) => {
                              const info = allLabels.find((l) => l.id === id);
                              if (!info) return null;
                              return <span key={id} className="text-[11px] font-medium bg-[var(--color-bg-elevated)] text-[var(--color-ink-soft)] px-2 py-0.5 rounded-[var(--radius-pill)]">{info.name}</span>;
                            })}
                          </div>
                        ) : <span className="text-[var(--color-ink-muted)] opacity-50">—</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-[var(--color-ink-soft)] tabular-nums">{duration(ticket)}</td>
                      <td className="px-4 py-3 text-[12px] text-[var(--color-ink-muted)] whitespace-nowrap tabular-nums">{fmt(ticket.createdAt)}</td>
                      <td className="px-4 py-3 text-[12px] text-[var(--color-ink-muted)] whitespace-nowrap tabular-nums">{fmt(ticket.closedAt || undefined)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-between bg-[var(--color-bg-elevated)]">
            <span className="text-[12px] text-[var(--color-ink-muted)]">{tickets.length} chats loaded</span>
            {hasMore && (
              <button
                onClick={() => {
                  const data = ticketsQuery.data as { nextCursor?: string } | undefined;
                  if (data?.nextCursor) setCursor(data.nextCursor);
                }}
                disabled={loading}
                className="h-8 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-hover)] text-[13px] font-medium text-[var(--color-ink)] disabled:opacity-40 transition-colors"
              >
                {loading ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Preview Panel */}
      {preview && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPreview(null)} aria-label="Close" />
          <div role="dialog" aria-modal="true" className="relative w-[560px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-modal)] h-full flex flex-col">
            {/* Preview Header */}
            <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-[11px] font-medium bg-[var(--color-bg-elevated)] text-[var(--color-ink-soft)] px-2 py-0.5 rounded-[var(--radius-pill)]">{preview.dept}</span>
                  <span className="text-[15px] font-semibold text-[var(--color-ink)]">{preview.agentName}</span>
                </div>
                <p className="text-[12px] text-[var(--color-ink-muted)]">
                  {preview.supportName ? `Support: ${preview.supportName}` : 'No support joined'} · {duration(preview)}
                </p>
                {preview.labels && (preview.labels as string[]).length > 0 && (
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {(preview.labels as string[]).map((id) => {
                      const info = allLabels.find((l) => l.id === id);
                      if (!info) return null;
                      return <span key={id} className="text-[11px] font-medium bg-[var(--color-bg-elevated)] text-[var(--color-ink-soft)] px-2 py-0.5 rounded-[var(--radius-pill)]">{info.name}</span>;
                    })}
                  </div>
                )}
              </div>
              <button
                onClick={() => setPreview(null)}
                aria-label="Close"
                className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {previewMessages.length === 0 ? (
                <p className="text-center text-[13px] text-[var(--color-ink-muted)] mt-8">No messages.</p>
              ) : previewMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`px-4 py-3 rounded-[var(--radius-bubble)] ${msg.whisper ? 'bg-[var(--color-whisper)]' : 'bg-[var(--color-bg-elevated)]'}`}
                >
                  <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                    <span className="text-[13px] font-semibold text-[var(--color-ink)]">{msg.senderName}</span>
                    <span className="text-[11px] text-[var(--color-ink-muted)] tabular-nums">
                      {new Date(msg.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {msg.whisper && <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-whisper-ink)]">whisper</span>}
                  </div>
                  <p className="text-[14px] leading-relaxed break-words text-[var(--color-ink)]">{msg.text}</p>
                  {msg.mediaUrl && (
                    <img src={msg.mediaUrl} alt="attachment" className="mt-2 max-h-60 object-contain rounded-[var(--radius-btn)]" />
                  )}
                </div>
              ))}
            </div>

            {/* Preview Footer */}
            <div className="px-6 py-3 border-t border-[var(--color-border)] shrink-0">
              <p className="text-[12px] text-[var(--color-ink-muted)] text-center">Read-only archive — conversation closed</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

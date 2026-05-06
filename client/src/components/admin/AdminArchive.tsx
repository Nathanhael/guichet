import { useState, useEffect, useMemo } from 'react';
import { X, Download, Inbox, ArrowDown, ArrowUp, Star } from 'lucide-react';
import { useT } from '../../i18n';
import { Ticket, Message } from '../../types';
import { trpc } from '../../utils/trpc';
import { usePartner } from '../../hooks/usePartner';

const LIMIT = 25;

const CARD = 'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)]';
const INPUT = 'h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';
const SELECT = 'h-9 pl-3 pr-8 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none cursor-pointer';
const COL_HEAD = 'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]';
const COL_HEAD_SORTABLE = `${COL_HEAD} cursor-pointer select-none hover:text-[var(--color-ink)]`;

type SortKey = 'created' | 'duration' | 'rating';
type SortDir = 'asc' | 'desc';

function durationMinutes(t: Ticket): number | null {
  if (!t.closedAt || !t.createdAt) return null;
  return Math.round((new Date(t.closedAt).getTime() - new Date(t.createdAt).getTime()) / 60000);
}

function formatDuration(min: number | null): string {
  if (min === null) return '—';
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
}

function formatTimestamp(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

function truncate(text: string, max = 80): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

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
  const [sortKey, setSortKey] = useState<SortKey>('created');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
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

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
      return;
    }
    setSortKey(key);
    setSortDir('desc');
  }

  const loading = ticketsQuery.isFetching;

  const filteredTickets = useMemo(() => {
    const labelFiltered = tickets.filter((ticket) => {
      if (labelFilter === 'all') return true;
      if (labelFilter === 'none') return !ticket.labels || (ticket.labels as string[]).length === 0;
      if (labelFilter === 'any') return ticket.labels && (ticket.labels as string[]).length > 0;
      return ticket.labels && (ticket.labels as string[]).includes(labelFilter);
    });

    const sortedKeys = labelFiltered.slice();
    sortedKeys.sort((a, b) => {
      let av: number;
      let bv: number;
      if (sortKey === 'created') {
        av = new Date(a.createdAt).getTime();
        bv = new Date(b.createdAt).getTime();
      } else if (sortKey === 'duration') {
        av = durationMinutes(a) ?? -Infinity;
        bv = durationMinutes(b) ?? -Infinity;
      } else {
        av = a.rating ?? -Infinity;
        bv = b.rating ?? -Infinity;
      }
      const diff = av - bv;
      return sortDir === 'desc' ? -diff : diff;
    });
    return sortedKeys;
  }, [tickets, labelFilter, sortKey, sortDir]);

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden">
      <div className="flex flex-col flex-1 min-h-0 min-w-0">
        {/* Header + Filters */}
        <div className="shrink-0 flex items-center gap-3 mb-5 flex-wrap">
          <h2 className="text-[22px] font-semibold tracking-[-0.2px] text-[var(--color-ink)] mr-auto">{t('archive')}</h2>
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
              placeholder={t('archive_search_placeholder')}
              title={t('archive_search_title')}
              className={`${INPUT} w-52`}
            />
            <div className={`flex items-center gap-1.5 ${INPUT.replace('h-9 px-3', 'h-9 px-2')}`}>
              <input
                type="date"
                aria-label={t('archive_start_date_aria')}
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); resetPagination(); }}
                className="bg-transparent text-[12px] outline-none text-[var(--color-ink)]"
              />
              <span className="text-[12px] text-[var(--color-ink-muted)]">→</span>
              <input
                type="date"
                aria-label={t('archive_end_date_aria')}
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
                {t('clear_dates')}
              </button>
            )}
            {departments.length > 0 && (
              <select
                value={dept}
                aria-label={t('archive_filter_dept_aria')}
                onChange={(e) => { setDept(e.target.value); resetPagination(); }}
                className={SELECT}
              >
                <option value="all">{t('archive_all_depts')}</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            {supportMembers.length > 0 && (
              <select
                value={supportFilter}
                aria-label={t('archive_filter_support_aria')}
                onChange={(e) => { setSupportFilter(e.target.value); resetPagination(); }}
                className={SELECT}
              >
                <option value="all">{t('archive_all_support')}</option>
                <option value="none">{t('archive_abandoned_no_support')}</option>
                {supportMembers.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
              </select>
            )}
            {allLabels.length > 0 && (
              <select
                value={labelFilter}
                onChange={(e) => setLabelFilter(e.target.value)}
                className={SELECT}
              >
                <option value="all">{t('archive_all_labels')}</option>
                <option value="none">{t('archive_no_label')}</option>
                <option value="any">{t('archive_has_label')}</option>
                {allLabels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* Table card — fills remaining height with internal scroll */}
        <div className={`${CARD} flex-1 min-h-0 flex flex-col overflow-hidden`}>
          <div className="flex-1 min-h-0 overflow-auto">
            {filteredTickets.length === 0 && !loading ? (
              <div className="flex flex-col items-center justify-center py-20 text-[var(--color-ink-muted)]">
                <Inbox className="h-10 w-10 opacity-50 mb-3" strokeWidth={1.5} />
                <p className="text-[13px]">{t('no_results')}</p>
              </div>
            ) : (
              <table className="w-full text-[13px] border-collapse">
                <thead className="sticky top-0 bg-[var(--color-bg-surface)] z-10">
                  <tr className="border-b border-[var(--color-border)]">
                    <th className={COL_HEAD}>{t('col_dept')}</th>
                    <th className={COL_HEAD}>{t('archive_col_title')}</th>
                    <th className={COL_HEAD}>{t('archive_col_ref')}</th>
                    <th className={COL_HEAD}>{t('col_support')}</th>
                    <th className={COL_HEAD}>{t('labels')}</th>
                    <SortableHeader
                      label={t('archive_col_rating')}
                      active={sortKey === 'rating'}
                      dir={sortDir}
                      onClick={() => toggleSort('rating')}
                    />
                    <SortableHeader
                      label={t('archive_col_duration')}
                      active={sortKey === 'duration'}
                      dir={sortDir}
                      onClick={() => toggleSort('duration')}
                    />
                    <SortableHeader
                      label={t('col_created')}
                      active={sortKey === 'created'}
                      dir={sortDir}
                      onClick={() => toggleSort('created')}
                    />
                    <th className={COL_HEAD}>{t('col_closed')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {filteredTickets.map((ticket) => {
                    const isAbandoned = !ticket.supportId;
                    const titleText = ticket.firstMessage ?? ticket.agentName ?? ticket.id;
                    const isSelected = preview?.id === ticket.id;
                    const rowClass = isSelected
                      ? 'bg-[var(--color-accent-soft)]'
                      : isAbandoned
                        ? 'bg-[var(--color-bg-elevated)]/50 hover:bg-[var(--color-hover)]'
                        : 'hover:bg-[var(--color-hover)]';
                    return (
                      <tr
                        key={ticket.id}
                        onClick={() => setPreview(isSelected ? null : ticket)}
                        className={`cursor-pointer transition-colors ${rowClass}`}
                      >
                        <td className="px-4 py-3 align-middle">
                          <span className="text-[11px] font-medium bg-[var(--color-bg-elevated)] text-[var(--color-ink-soft)] px-2 py-0.5 rounded-[var(--radius-pill)]">{ticket.dept}</span>
                        </td>
                        <td className="px-4 py-3 align-middle max-w-[28ch]">
                          <span
                            className="block truncate text-[var(--color-ink)]"
                            title={titleText}
                          >
                            {truncate(titleText, 80)}
                          </span>
                          <span className="block text-[11px] text-[var(--color-ink-muted)] truncate">
                            {ticket.agentName}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-middle text-[12px] text-[var(--color-ink-muted)]">
                          {(ticket.references as Array<{label: string; value: string}> || []).length > 0
                            ? (ticket.references as Array<{label: string; value: string}> || []).map((ref) => (
                                <span key={ref.label} className="mr-3 whitespace-nowrap">
                                  <span className="text-[var(--color-ink-muted)]">{ref.label}:</span>{' '}
                                  <span className="font-mono text-[var(--color-ink)]">{ref.value}</span>
                                </span>
                              ))
                            : <span className="text-[var(--color-ink-muted)] opacity-50">—</span>}
                        </td>
                        <td className="px-4 py-3 align-middle text-[13px] text-[var(--color-ink-soft)]">
                          {ticket.supportName || <span className="italic text-[var(--color-ink-muted)]">{t('archive_abandoned_inline')}</span>}
                        </td>
                        <td className="px-4 py-3 align-middle">
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
                        <td className="px-4 py-3 align-middle font-mono text-[12px] tabular-nums">
                          <RatingCell rating={ticket.rating ?? null} />
                        </td>
                        <td className="px-4 py-3 align-middle font-mono text-[12px] text-[var(--color-ink-soft)] tabular-nums">
                          {formatDuration(durationMinutes(ticket))}
                        </td>
                        <td className="px-4 py-3 align-middle text-[12px] text-[var(--color-ink-muted)] whitespace-nowrap tabular-nums">
                          {formatTimestamp(ticket.createdAt)}
                        </td>
                        <td className="px-4 py-3 align-middle text-[12px] whitespace-nowrap tabular-nums">
                          {ticket.closedAt
                            ? <span className="text-[var(--color-ink-muted)]">{formatTimestamp(ticket.closedAt)}</span>
                            : <span className="italic text-[var(--color-ink-muted)] opacity-70">{t('archive_no_close_inline')}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="shrink-0 px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-between bg-[var(--color-bg-elevated)]">
            <span className="text-[12px] text-[var(--color-ink-muted)]">{t('archive_chats_loaded').replace('{count}', String(tickets.length))}</span>
            {hasMore && (
              <button
                onClick={() => {
                  const data = ticketsQuery.data as { nextCursor?: string } | undefined;
                  if (data?.nextCursor) setCursor(data.nextCursor);
                }}
                disabled={loading}
                className="h-8 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-hover)] text-[13px] font-medium text-[var(--color-ink)] disabled:opacity-40 transition-colors"
              >
                {loading ? t('loading') : t('load_more')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Preview Panel */}
      {preview && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPreview(null)} aria-label={t('close')} />
          <div role="dialog" aria-modal="true" className="relative w-[560px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-modal)] h-full flex flex-col">
            {/* Preview Header */}
            <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-[11px] font-medium bg-[var(--color-bg-elevated)] text-[var(--color-ink-soft)] px-2 py-0.5 rounded-[var(--radius-pill)]">{preview.dept}</span>
                  <span className="text-[15px] font-semibold text-[var(--color-ink)]">{preview.agentName}</span>
                  {preview.rating != null && <RatingCell rating={preview.rating} />}
                </div>
                <p className="text-[12px] text-[var(--color-ink-muted)]">
                  {preview.supportName ? `${t('support_prefix')} ${preview.supportName}` : t('archive_no_support_joined')} · {formatDuration(durationMinutes(preview))}
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
                aria-label={t('close')}
                className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {previewMessages.length === 0 ? (
                <p className="text-center text-[13px] text-[var(--color-ink-muted)] mt-8">{t('no_messages')}</p>
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
                    {!!msg.whisper && <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-whisper-ink)]">{t('whisper_label')}</span>}
                  </div>
                  <p className="text-[14px] leading-relaxed break-words text-[var(--color-ink)]">{msg.text}</p>
                  {msg.mediaUrl && (
                    <img src={msg.mediaUrl} alt={t('archive_image_alt')} className="mt-2 max-h-60 object-contain rounded-[var(--radius-btn)]" />
                  )}
                </div>
              ))}
            </div>

            {/* Preview Footer */}
            <div className="px-6 py-3 border-t border-[var(--color-border)] shrink-0">
              <p className="text-[12px] text-[var(--color-ink-muted)] text-center">{t('archive_read_only')}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface SortableHeaderProps {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}

function SortableHeader({ label, active, dir, onClick }: SortableHeaderProps) {
  const Icon = dir === 'desc' ? ArrowDown : ArrowUp;
  return (
    <th onClick={onClick} className={COL_HEAD_SORTABLE}>
      <span className={`inline-flex items-center gap-1 ${active ? 'text-[var(--color-ink)]' : ''}`}>
        {label}
        {active && <Icon className="h-3 w-3" strokeWidth={2.5} />}
      </span>
    </th>
  );
}

function RatingCell({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="text-[var(--color-ink-muted)] opacity-50">—</span>;
  const tone = rating >= 4 ? 'text-[var(--color-ok,#22c55e)]' : rating >= 3 ? 'text-[var(--color-accent-amber,#f59e0b)]' : 'text-[var(--color-urgent,#ef4444)]';
  return (
    <span className={`inline-flex items-center gap-0.5 ${tone}`}>
      <Star className="h-3 w-3 fill-current" strokeWidth={0} />
      <span className="font-mono">{rating.toFixed(1)}</span>
    </span>
  );
}

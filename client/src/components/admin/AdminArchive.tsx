import { useState, useEffect } from 'react';
import { useT } from '../../i18n';
import { Ticket, Message } from '../../types';
import { trpc } from '../../utils/trpc';

const LIMIT = 25;

export default function AdminArchive() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [dept, _setDept] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [preview, setPreview] = useState<Ticket | null>(null);
  const [previewMessages, setPreviewMessages] = useState<Message[]>([]);
  const [labelFilter, setLabelFilter] = useState('all');
  const t = useT();

  const { data: allLabels = [] } = trpc.label.list.useQuery();

  const ticketsQuery = trpc.ticket.list.useQuery({
    status: ['closed', 'resolved'],
    limit: LIMIT,
    cursor,
    dept: dept === 'all' ? undefined : dept,
    search: search.trim() || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  useEffect(() => {
    if (ticketsQuery.data) {
      const data = ticketsQuery.data as { tickets?: Ticket[]; nextCursor?: string };
      if (data.tickets) {
        setTickets((prev) => !cursor ? data.tickets! : [...prev, ...data.tickets!]);
        setHasMore(!!data.nextCursor);
      }
    }
  }, [ticketsQuery.data, cursor]);

  const messagesQuery = trpc.message.list.useQuery(
    { ticketId: preview?.id || '' },
    { enabled: !!preview?.id }
  );

  useEffect(() => {
    if (messagesQuery.data) setPreviewMessages(messagesQuery.data.messages as unknown as Message[]);
  }, [messagesQuery.data]);

  useEffect(() => { setCursor(undefined); setTickets([]); setHasMore(false); }, [search, dept, dateFrom, dateTo]);

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
    <div className="min-w-[1280px] flex gap-4 items-start">
      <div className="flex-1 min-w-0">
        {/* Header + Filters */}
        <div className="flex items-center gap-2 mb-4 border-b border-[var(--color-border)] pb-4 overflow-x-auto">
          <h2 className="text-4xl font-bold uppercase tracking-tighter mr-auto">Archive</h2>
          <button
            onClick={() => {
              const params = new URLSearchParams();
              if (dept !== 'all') params.set('dept', dept);
              if (search.trim()) params.set('search', search.trim());
              if (dateFrom) params.set('dateFrom', dateFrom);
              if (dateTo) params.set('dateTo', dateTo);
              window.open(`/api/v1/tickets/export?${params.toString()}`, '_blank');
            }}
            className="btn-secondary"
            title={t('export_csv')}
          >
            {t('export_csv')}
          </button>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agent, ref, support…"
            className="input-field w-52"
          />
          <input
            type="date"
            aria-label="Start date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="input-field"
          />
          <span className="text-xs font-bold">→</span>
          <input
            type="date"
            aria-label="End date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="input-field"
          />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="mono-label border border-[var(--color-border)] px-2 py-1">
              ✕ Clear
            </button>
          )}
          {allLabels.length > 0 && (
            <select
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
              className="input-field text-xs font-bold uppercase"
            >
              <option value="all">All labels</option>
              <option value="none">No label</option>
              <option value="any">Has label</option>
              {allLabels.map((l) => <option key={l.id} value={l.id}>{l.text}</option>)}
            </select>
          )}
        </div>

        {/* Table */}
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            {filteredTickets.length === 0 && !loading ? (
              <p className="text-center mono-label text-[var(--color-text-muted)] py-12">No results.</p>
            ) : (
              <table className="w-full min-w-[1120px] text-sm border-collapse">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-bg-elevated text-left font-mono text-[9px] uppercase text-[var(--color-text-muted)]">
                    <th className="px-4 py-3">Dept</th>
                    <th className="px-4 py-3">Agent</th>
                    <th className="px-4 py-3">Ref</th>
                    <th className="px-4 py-3">Support</th>
                    <th className="px-4 py-3">Labels</th>
                    <th className="px-4 py-3">Duration</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Closed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {filteredTickets.map((ticket) => (
                    <tr
                      key={ticket.id}
                      onClick={() => setPreview(preview?.id === ticket.id ? null : ticket)}
                      className={`cursor-pointer ${preview?.id === ticket.id ? 'bg-bg-elevated' : 'hover:bg-bg-elevated'}`}
                    >
                      <td className="px-4 py-2.5">
                        <span className="mono-label border border-[var(--color-border)] px-1.5 py-0.5">{ticket.dept}</span>
                      </td>
                      <td className="px-4 py-2.5 font-bold">{ticket.agentName}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-text-secondary)]">
                        {(ticket.references as Array<{label: string; value: string}> || []).length > 0
                          ? (ticket.references as Array<{label: string; value: string}> || []).map((ref) => (
                              <span key={ref.label} className="mr-2">
                                <span className="text-[var(--color-text-secondary)] uppercase text-[9px] font-bold tracking-wide">{ref.label}:</span>{' '}
                                <span className="font-bold">{ref.value}</span>
                              </span>
                            ))
                          : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">
                        {ticket.supportName || <span className="italic">Abandoned</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {ticket.labels && (ticket.labels as string[]).length > 0 ? (
                          <div className="flex gap-1 overflow-x-auto">
                            {(ticket.labels as string[]).map((id) => {
                              const info = allLabels.find((l) => l.id === id);
                              if (!info) return null;
                              return <span key={id} className="font-mono text-[9px] uppercase border border-[var(--color-border)] px-1 py-0.5">{info.text}</span>;
                            })}
                          </div>
                        ) : <span className="opacity-30">—</span>}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-text-secondary)]">{duration(ticket)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-text-secondary)] whitespace-nowrap">{fmt(ticket.createdAt)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-text-secondary)] whitespace-nowrap">{fmt(ticket.closedAt || undefined)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-between">
            <span className="mono-label text-[var(--color-text-secondary)]">{tickets.length} chats loaded</span>
            {hasMore && (
              <button
                onClick={() => {
                  const data = ticketsQuery.data as { nextCursor?: string } | undefined;
                  if (data?.nextCursor) setCursor(data.nextCursor);
                }}
                disabled={loading}
                className="btn-secondary disabled:opacity-30"
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
          <div className="absolute inset-0 bg-black/60" onClick={() => setPreview(null)} aria-label="Close" />
          <div role="dialog" aria-modal="true" className="relative w-[550px] bg-[var(--color-bg-surface)] border-l border-[var(--color-border)] h-full flex flex-col">
            {/* Preview Header */}
            <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-start justify-between gap-3 shrink-0">
              <div>
                <div className="flex items-center gap-2 mb-1 overflow-x-auto">
                  <span className="mono-label border border-[var(--color-border)] px-1.5 py-0.5">{preview.dept}</span>
                  <span className="font-bold uppercase tracking-tight">{preview.agentName}</span>
                </div>
                <p className="text-xs font-mono text-[var(--color-text-secondary)]">
                  {preview.supportName ? `Support: ${preview.supportName}` : 'No support joined'} · {duration(preview)}
                </p>
                {preview.labels && (preview.labels as string[]).length > 0 && (
                  <div className="flex gap-1 mt-2 overflow-x-auto">
                    {(preview.labels as string[]).map((id) => {
                      const info = allLabels.find((l) => l.id === id);
                      if (!info) return null;
                      return <span key={id} className="font-mono text-[9px] uppercase border border-[var(--color-border)] px-1 py-0.5">{info.text}</span>;
                    })}
                  </div>
                )}
              </div>
              <button onClick={() => setPreview(null)} aria-label="Close" className="w-8 h-8 border border-[var(--color-border)] flex items-center justify-center font-bold shrink-0">✕</button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {previewMessages.length === 0 ? (
                <p className="text-center mono-label text-[var(--color-text-muted)] mt-8">No messages.</p>
              ) : previewMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`px-3 py-2 border ${msg.whisper ? 'border-[var(--color-border)] bg-bg-elevated' : 'border-transparent'}`}
                >
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-sm font-bold uppercase tracking-tight">{msg.senderName}</span>
                    <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
                      {new Date(msg.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {msg.whisper && <span className="font-mono text-[9px] uppercase border border-[var(--color-border)] px-1">whisper</span>}
                  </div>
                  <p className="text-sm leading-relaxed break-words">{msg.text}</p>
                  {msg.mediaUrl && (
                    <img src={msg.mediaUrl} alt="attachment" className="mt-2 max-h-60 object-contain border border-[var(--color-border)]" />
                  )}
                </div>
              ))}
            </div>

            {/* Preview Footer */}
            <div className="px-6 py-3 border-t border-[var(--color-border)] shrink-0">
              <p className="mono-label text-[var(--color-text-muted)] text-center">Read-only archive — conversation closed</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

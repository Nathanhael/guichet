import { useState, useEffect } from 'react';
import { useT } from '../../i18n';
import { Ticket, Message } from '../../types';
import useStore from '../../store/useStore';
import { trpc } from '../../utils/trpc';

const LIMIT = 25;

export default function AdminArchive() {
  const { token } = useStore();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
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
    status: 'closed',
    limit: LIMIT,
    offset,
    dept: dept === 'all' ? undefined : dept,
    search: search.trim() || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  useEffect(() => {
    if (ticketsQuery.data) {
      const data = ticketsQuery.data as any;
      if (data.tickets) {
        setTickets((prev) => offset === 0 ? data.tickets : [...prev, ...data.tickets]);
        setTotal(data.total);
      }
    }
  }, [ticketsQuery.data, offset]);

  const messagesQuery = trpc.message.list.useQuery(
    { ticketId: preview?.id || '' },
    { enabled: !!preview?.id }
  );

  useEffect(() => {
    if (messagesQuery.data) setPreviewMessages(messagesQuery.data as any);
  }, [messagesQuery.data]);

  useEffect(() => { setOffset(0); }, [search, dept, dateFrom, dateTo]);

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
        <div className="flex items-center gap-2 mb-4 border-b-4 border-black dark:border-white pb-4 overflow-x-auto">
          <h2 className="text-4xl font-black uppercase tracking-tighter mr-auto">Archive</h2>
          <button
            onClick={() => {
              const params = new URLSearchParams();
              if (dept !== 'all') params.set('dept', dept);
              if (search.trim()) params.set('search', search.trim());
              if (dateFrom) params.set('dateFrom', dateFrom);
              if (dateTo) params.set('dateTo', dateTo);
              params.set('token', token || '');
              window.open(`/api/v1/tickets/export?${params.toString()}`, '_blank');
            }}
            className="px-3 py-2 border-2 border-black dark:border-white text-[10px] font-black uppercase tracking-widest"
            title={t('export_csv')}
          >
            {t('export_csv')}
          </button>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agent, ref, support…"
            className="border-2 border-black dark:border-white px-3 py-1.5 text-sm font-bold bg-transparent outline-none w-52"
          />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border-2 border-black dark:border-white px-2 py-1.5 text-sm bg-transparent outline-none"
          />
          <span className="text-xs font-black">→</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="border-2 border-black dark:border-white px-2 py-1.5 text-sm bg-transparent outline-none"
          />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-[10px] font-black uppercase tracking-widest border border-black dark:border-white px-2 py-1">
              ✕ Clear
            </button>
          )}
          {allLabels.length > 0 && (
            <select
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
              className="border-2 border-black dark:border-white px-2 py-1.5 text-xs font-black bg-transparent outline-none uppercase"
            >
              <option value="all">All labels</option>
              <option value="none">No label</option>
              <option value="any">Has label</option>
              {allLabels.map((l) => <option key={l.id} value={l.id}>{l.text}</option>)}
            </select>
          )}
        </div>

        {/* Table */}
        <div className="border-2 border-black dark:border-white overflow-hidden">
          <div className="overflow-x-auto">
            {filteredTickets.length === 0 && !loading ? (
              <p className="text-center text-[10px] font-black uppercase opacity-50 py-12">No results.</p>
            ) : (
              <table className="w-full min-w-[1120px] text-sm border-collapse">
                <thead>
                  <tr className="border-b-2 border-black dark:border-white bg-black/5 dark:bg-white/5 text-left text-[10px] font-black uppercase tracking-widest">
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
                <tbody className="divide-y divide-black/20 dark:divide-white/20">
                  {filteredTickets.map((ticket) => (
                    <tr
                      key={ticket.id}
                      onClick={() => setPreview(preview?.id === ticket.id ? null : ticket)}
                      className={`cursor-pointer ${preview?.id === ticket.id ? 'bg-black/10 dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}
                    >
                      <td className="px-4 py-2.5">
                        <span className="text-[10px] font-black uppercase border border-black dark:border-white px-1.5 py-0.5">{ticket.dept}</span>
                      </td>
                      <td className="px-4 py-2.5 font-bold">{ticket.agentName}</td>
                      <td className="px-4 py-2.5 font-mono text-xs opacity-60">
                        {(ticket as any).cdbId ? `CDBID: ${(ticket as any).cdbId}` : (ticket as any).dareRef ? `Ref: ${(ticket as any).dareRef}` : '—'}
                      </td>
                      <td className="px-4 py-2.5 opacity-60">
                        {ticket.supportName || <span className="italic">Abandoned</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {ticket.labels && (ticket.labels as string[]).length > 0 ? (
                          <div className="flex gap-1 overflow-x-auto">
                            {(ticket.labels as string[]).map((id) => {
                              const info = allLabels.find((l) => l.id === id);
                              if (!info) return null;
                              return <span key={id} className="text-[9px] font-black uppercase border border-black dark:border-white px-1 py-0.5">{info.text}</span>;
                            })}
                          </div>
                        ) : <span className="opacity-30">—</span>}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs opacity-60">{duration(ticket)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs opacity-60 whitespace-nowrap">{fmt(ticket.createdAt)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs opacity-60 whitespace-nowrap">{fmt(ticket.closedAt || undefined)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-4 py-3 border-t border-black/20 dark:border-white/20 flex items-center justify-between">
            <span className="text-[10px] font-black uppercase opacity-60">{tickets.length} of {total} chats</span>
            {tickets.length < total && (
              <button
                onClick={() => setOffset(tickets.length)}
                disabled={loading}
                className="text-[10px] font-black uppercase tracking-widest border border-black dark:border-white px-3 py-1.5 disabled:opacity-30"
              >
                {loading ? 'Loading…' : `Load more (${total - tickets.length} remaining)`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Preview Panel */}
      {preview && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setPreview(null)} />
          <div className="relative w-[550px] bg-white dark:bg-black border-l-4 border-black dark:border-white h-full flex flex-col">
            {/* Preview Header */}
            <div className="px-6 py-4 border-b-2 border-black dark:border-white flex items-start justify-between gap-3 shrink-0">
              <div>
                <div className="flex items-center gap-2 mb-1 overflow-x-auto">
                  <span className="text-[10px] font-black uppercase border border-black dark:border-white px-1.5 py-0.5">{preview.dept}</span>
                  <span className="font-black uppercase tracking-tight">{preview.agentName}</span>
                </div>
                <p className="text-xs font-mono opacity-60">
                  {preview.supportName ? `Support: ${preview.supportName}` : 'No support joined'} · {duration(preview)}
                </p>
                {preview.labels && (preview.labels as string[]).length > 0 && (
                  <div className="flex gap-1 mt-2 overflow-x-auto">
                    {(preview.labels as string[]).map((id) => {
                      const info = allLabels.find((l) => l.id === id);
                      if (!info) return null;
                      return <span key={id} className="text-[9px] font-black uppercase border border-black dark:border-white px-1 py-0.5">{info.text}</span>;
                    })}
                  </div>
                )}
              </div>
              <button onClick={() => setPreview(null)} className="w-8 h-8 border-2 border-black dark:border-white flex items-center justify-center font-black shrink-0">✕</button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {previewMessages.length === 0 ? (
                <p className="text-center text-[10px] font-black uppercase opacity-50 mt-8">No messages.</p>
              ) : previewMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`px-3 py-2 border ${msg.whisper ? 'border-black/40 dark:border-white/40 bg-black/5 dark:bg-white/5' : 'border-transparent'}`}
                >
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-sm font-black uppercase tracking-tight">{msg.senderName}</span>
                    <span className="text-[10px] font-mono opacity-50">
                      {new Date(msg.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {msg.whisper && <span className="text-[9px] font-black uppercase border border-black dark:border-white px-1">whisper</span>}
                  </div>
                  <p className="text-sm leading-relaxed break-words">{msg.text}</p>
                  {msg.mediaUrl && (
                    <img src={msg.mediaUrl} alt="attachment" className="mt-2 max-h-60 object-contain border border-black dark:border-white" />
                  )}
                </div>
              ))}
            </div>

            {/* Preview Footer */}
            <div className="px-6 py-3 border-t-2 border-black dark:border-white shrink-0">
              <p className="text-[10px] font-black uppercase tracking-widest opacity-50 text-center">Read-only archive — conversation closed</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

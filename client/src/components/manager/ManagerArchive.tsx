import React, { useState, useEffect } from 'react';
import { useT } from '../../i18n';
import { Ticket, Message, Label } from '../../types';

const LIMIT = 25;
const DEPT_COLOR: Record<string, string> = { DSC: 'bg-purple-100 text-purple-700', FOT: 'bg-teal-100 text-teal-700' };

export default function ManagerArchive() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [preview, setPreview] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  const [labelFilter, setLabelFilter] = useState('all');
  const t = useT();

  function fetchTickets({ reset = false, off = 0 } = {}) {
    setLoading(true);
    const params = new URLSearchParams({ status: 'closed', limit: String(LIMIT), offset: String(off) });
    if (dept !== 'all') params.set('dept', dept);
    if (search.trim()) params.set('search', search.trim());
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    fetch(`/api/tickets?${params}`)
      .then((r) => r.json())
      .then(({ tickets: rows, total: tCount }) => {
        setTickets((prev) => (reset ? rows : [...prev, ...rows]));
        setTotal(tCount);
        setOffset(off + rows.length);
      })
      .catch(() => {
        if (reset) setTickets([]);
      })
      .finally(() => setLoading(false));
  }

  // initial load
  useEffect(() => {
    fetchTickets({ reset: true });
    fetch('/api/labels')
      .then((r) => r.json())
      .then(setAllLabels)
      .catch(console.error);
  }, []);

  // debounced refetch on filter change
  useEffect(() => {
    const timer = setTimeout(() => fetchTickets({ reset: true, off: 0 }), 300);
    return () => clearTimeout(timer);
  }, [search, dept, dateFrom, dateTo]);

  useEffect(() => {
    if (!preview) return;
    fetch(`/api/messages?ticketId=${preview.id}`)
      .then((r) => r.json())
      .then(setMessages)
      .catch(() => setMessages([]));
  }, [preview?.id]);

  function duration(tk: Ticket) {
    if (!tk.closedAt || !tk.createdAt) return '—';
    const m = Math.round((new Date(tk.closedAt).getTime() - new Date(tk.createdAt).getTime()) / 60000);
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  function fmt(iso?: string) {
    return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  }

  return (
    <div className="flex gap-4 items-start">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <h2 className="text-xl font-bold text-solarized-base01 dark:text-white mr-auto">Archive</h2>
          <button
            onClick={() => {
              const params = new URLSearchParams();
              if (dept !== 'all') params.set('dept', dept);
              if (search.trim()) params.set('search', search.trim());
              if (dateFrom) params.set('dateFrom', dateFrom);
              if (dateTo) params.set('dateTo', dateTo);
              window.open(`/api/export?${params.toString()}`, '_blank');
            }}
            className="flex items-center gap-2 bg-solarized-base2 dark:bg-brand-900/40 hover:bg-solarized-base2 hover:text-solarized-base01 text-brand-700 dark:text-brand-300 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border border-solarized-base2 dark:border-brand-700/50 mr-2 shadow-sm"
            title={t('export_csv')}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {t('export_csv')}
          </button>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agent, CDBID, Dare Ref, expert…"
            className="border border-solarized-base2 dark:border-brand-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-56 bg-solarized-base3 dark:bg-gray-700 text-solarized-base01 dark:text-gray-100"
          />
          <div className="flex gap-1">
            {['all', 'DSC', 'FOT'].map((d) => (
              <button
                key={d}
                onClick={() => setDept(d)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  dept === d
                    ? 'bg-brand-500 text-white'
                    : 'bg-solarized-base2 dark:bg-gray-700 text-solarized-base1 dark:text-gray-400 hover:bg-solarized-base2 hover:text-solarized-base01 dark:hover:bg-gray-600'
                }`}
              >
                {d === 'all' ? 'All' : d}
              </button>
            ))}
          </div>
          {allLabels.length > 0 && (
            <select
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
              className="border border-solarized-base2 dark:border-brand-600 rounded-lg px-2 py-1.5 text-xs font-medium bg-solarized-base3 dark:bg-gray-700 text-solarized-base01 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="all">All labels</option>
              <option value="none">No label</option>
              <option value="any">Has label</option>
              {allLabels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.text}
                </option>
              ))}
            </select>
          )}
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border border-solarized-base2 dark:border-brand-600 rounded-lg px-2 py-1.5 text-sm bg-solarized-base3 dark:bg-gray-700 text-solarized-base01 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <span className="text-solarized-base1 text-xs">→</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="border border-solarized-base2 dark:border-brand-600 rounded-lg px-2 py-1.5 text-sm bg-solarized-base3 dark:bg-gray-700 text-solarized-base01 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-xs text-solarized-base1 hover:text-brand-500 transition-colors">
              ✕ Clear dates
            </button>
          )}
        </div>

        <div className="bg-solarized-base3 dark:bg-brand-800 rounded-xl shadow-sm border border-solarized-base2 dark:border-brand-700 overflow-hidden">
          <div className="overflow-x-auto">
            {tickets.length === 0 && !loading ? (
              <p className="text-center text-solarized-base1 py-12 text-sm">No results.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-solarized-base3 dark:bg-brand-800">
                  <tr className="border-b border-solarized-base2 dark:border-brand-700 text-left text-xs text-solarized-base1 dark:text-gray-400 uppercase tracking-wide">
                    <th className="px-4 py-3">Dept</th>
                    <th className="px-4 py-3">Agent</th>
                    <th className="px-4 py-3">Ref</th>
                    <th className="px-4 py-3">Expert</th>
                    <th className="px-4 py-3">Labels</th>
                    <th className="px-4 py-3">Duration</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Closed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                  {tickets
                    .filter((ticket) => {
                      if (labelFilter === 'all') return true;
                      if (labelFilter === 'none') return !ticket.labels || ticket.labels.length === 0;
                      if (labelFilter === 'any') return ticket.labels && ticket.labels.length > 0;
                      return ticket.labels && ticket.labels.includes(labelFilter);
                    })
                    .map((ticket) => (
                      <tr
                        key={ticket.id}
                        onClick={() => setPreview(preview?.id === ticket.id ? null : ticket)}
                        className={`cursor-pointer transition-colors ${
                          preview?.id === ticket.id ? 'bg-solarized-base2 dark:bg-brand-900/20' : 'hover:bg-solarized-base2 dark:hover:bg-brand-700'
                        }`}
                      >
                        <td className="px-4 py-2.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${DEPT_COLOR[ticket.dept]}`}>{ticket.dept}</span>
                        </td>
                        <td className="px-4 py-2.5 font-medium text-solarized-base01 dark:text-gray-100">{ticket.agentName}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-brand-600 dark:text-brand-400">
                          {ticket.cdbId ? `CDBID: ${ticket.cdbId}` : ticket.dareRef ? `Dare Ref: ${ticket.dareRef}` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-solarized-base1 dark:text-gray-400">
                          {ticket.expertName || <span className="italic text-solarized-base2">Abandoned</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          {ticket.labels && ticket.labels.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {ticket.labels.map((id) => {
                                const info = allLabels.find((l) => l.id === id);
                                if (!info) return null;
                                return (
                                  <span
                                    key={id}
                                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded bg-${info.color}-100 text-${info.color}-700 dark:bg-${info.color}-900/30 dark:text-${info.color}-400`}
                                  >
                                    {info.text}
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="text-solarized-base2 dark:text-gray-600">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-solarized-base1 dark:text-gray-400">{duration(ticket)}</td>
                        <td className="px-4 py-2.5 text-solarized-base1 whitespace-nowrap">{fmt(ticket.createdAt)}</td>
                        <td className="px-4 py-2.5 text-solarized-base1 whitespace-nowrap">{fmt(ticket.closedAt)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-4 py-3 border-t border-solarized-base2 dark:border-brand-700 flex items-center justify-between shrink-0">
            <span className="text-xs text-solarized-base1">
              {tickets.length} of {total} chats
            </span>
            {tickets.length < total && (
              <button
                onClick={() => fetchTickets({ off: offset })}
                disabled={loading}
                className="text-xs px-3 py-1.5 rounded-lg border border-solarized-base2 dark:border-brand-600 text-solarized-base1 dark:text-gray-400 hover:bg-solarized-base2 dark:hover:bg-brand-700 disabled:opacity-40 transition-colors"
              >
                {loading ? 'Loading…' : `Load more (${total - tickets.length} remaining)`}
              </button>
            )}
          </div>
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-brand-900/40 backdrop-blur-sm transition-opacity animate-fade-in" onClick={() => setPreview(null)}></div>
          <div className="relative w-full max-w-[550px] bg-solarized-base3 dark:bg-brand-800 shadow-2xl border-l border-solarized-base2 dark:border-brand-700 h-full flex flex-col animate-slide-in-right">
            <div className="px-6 py-4 border-b border-solarized-base2 dark:border-brand-700 flex items-start justify-between gap-3 shrink-0 bg-solarized-base2/50 dark:bg-brand-900/20">
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${DEPT_COLOR[preview.dept]}`}>{preview.dept}</span>
                  <span className="text-base font-bold text-solarized-base01 dark:text-gray-100">{preview.agentName}</span>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-mono text-solarized-base1 dark:text-gray-400">
                  {preview.cdbId && <span className="bg-solarized-base2 dark:bg-brand-700 px-2 py-0.5 rounded">CDBID: {preview.cdbId}</span>}
                  {preview.dareRef && <span className="bg-solarized-base2 dark:bg-brand-700 px-2 py-0.5 rounded">Dare Ref: {preview.dareRef}</span>}
                </div>
                <p className="text-sm text-solarized-base1 dark:text-gray-400 mt-2 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                  </svg>
                  {preview.expertName ? `Expert: ${preview.expertName}` : 'No expert joined'}
                  <span className="text-solarized-base2 dark:text-brand-600">•</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {duration(preview)}
                </p>
                {preview.labels && preview.labels.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {preview.labels.map((id) => {
                      const info = allLabels.find((l) => l.id === id);
                      if (!info) return null;
                      return (
                        <span
                          key={id}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-${info.color}-500/10 text-${info.color}-600 dark:text-${info.color}-400 border border-${info.color}-500/20`}
                        >
                          {info.text}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              <button
                onClick={() => setPreview(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-solarized-base2 text-solarized-base1 hover:bg-solarized-base2 hover:text-solarized-base01 dark:bg-brand-700 dark:text-gray-400 dark:hover:bg-brand-600 dark:hover:text-white transition-colors shrink-0"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 bg-solarized-base3/10 dark:bg-transparent">
              {messages.length === 0 ? (
                <p className="text-center text-solarized-base1 text-sm mt-8">No messages.</p>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-3 px-3 py-2 rounded-xl border border-transparent ${
                      msg.whisper ? 'bg-violet-50 dark:bg-violet-900/10 border-violet-100 dark:border-violet-900/30' : 'hover:bg-gray-50 dark:hover:bg-brand-900/20'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-700 flex items-center justify-center text-xs font-bold text-brand-700 dark:text-brand-300 shrink-0 shadow-sm">
                      {(msg.senderName || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-baseline gap-2 mb-1 cursor-default">
                        <span className="text-sm font-bold text-solarized-base01 dark:text-gray-100">{msg.senderName}</span>
                        <span className="text-xs text-solarized-base1">
                          {new Date(msg.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {msg.whisper && (
                          <span className="text-[10px] font-medium uppercase tracking-wider text-violet-500 bg-violet-100 dark:bg-violet-900/50 dark:text-violet-300 px-1.5 py-0.5 rounded leading-none">
                            whisper
                          </span>
                        )}
                      </div>
                      <p className={`text-[15px] break-words leading-relaxed ${msg.whisper ? 'text-violet-700 dark:text-violet-300' : 'text-solarized-base01 dark:text-gray-200'}`}>
                        {msg.text}
                      </p>
                      {msg.mediaUrl && (
                        <img
                          src={msg.mediaUrl}
                          alt="screenshot"
                          className="mt-2 rounded-lg max-h-60 object-contain border border-gray-200 dark:border-brand-600 shadow-sm"
                        />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="px-6 py-4 border-t border-solarized-base2 dark:border-brand-700 shrink-0 bg-solarized-base2 dark:bg-brand-900/50">
              <p className="text-sm font-medium text-solarized-base1 dark:text-gray-400 flex items-center justify-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Read-only archive — conversation closed
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

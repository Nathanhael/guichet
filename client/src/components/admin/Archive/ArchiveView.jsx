import React, { useState, useEffect } from 'react';
import { useT } from '../../../i18n';
import ArchiveDrawer from './ArchiveDrawer';
import useStore from '../../../store/useStore';

const LIMIT = 25;
const DEPT_COLOR = { DSC: 'bg-purple-100 text-purple-700', FOT: 'bg-teal-100 text-teal-700' };

export default function ArchiveView() {
    const { token } = useStore();
    const [tickets, setTickets] = useState([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [search, setSearch] = useState('');
    const [dept, setDept] = useState('all');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [preview, setPreview] = useState(null);
    const [messages, setMessages] = useState([]);
    const [allLabels, setAllLabels] = useState([]);
    const [labelFilter, setLabelFilter] = useState('all');
    const t = useT();

    function fetchTickets({ reset = false, s = search, d = dept, from = dateFrom, to = dateTo, off = 0 } = {}) {
        setLoading(true);
        const params = new URLSearchParams({ status: 'closed', limit: LIMIT, offset: off });
        if (d !== 'all') params.set('dept', d);
        if (s.trim()) params.set('search', s.trim());
        if (from) params.set('dateFrom', from);
        if (to) params.set('dateTo', to);
        fetch(`/api/tickets?${params}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
            .then((r) => r.json())
            .then(({ tickets: rows, total: t }) => {
                setTickets((prev) => reset ? rows : [...prev, ...rows]);
                setTotal(t);
                setOffset(off + rows.length);
            })
            .catch(() => { if (reset) setTickets([]); })
            .finally(() => setLoading(false));
    }

    useEffect(() => {
        fetchTickets({ reset: true });
        fetch('/api/labels', {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.json()).then(setAllLabels).catch(console.error);
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => fetchTickets({ reset: true, s: search, d: dept, from: dateFrom, to: dateTo, off: 0 }), 300);
        return () => clearTimeout(timer);
    }, [search, dept, dateFrom, dateTo]);

    useEffect(() => {
        if (!preview) return;
        fetch(`/api/messages?ticketId=${preview.id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
            .then((r) => r.json())
            .then(setMessages)
            .catch(() => setMessages([]));
    }, [preview?.id]);

    function duration(t) {
        if (!t.closedAt || !t.createdAt) return '—';
        const m = Math.round((new Date(t.closedAt) - new Date(t.createdAt)) / 60000);
        return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
    }
    function fmt(iso) {
        return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    }

    return (
        <div className="flex gap-4 items-start">
            <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-4">
                    <h2 className="text-xl font-bold text-gray-800 dark:text-white mr-auto">Archive</h2>
                    <button
                        onClick={async () => {
                            try {
                                setIsExporting(true);
                                const params = new URLSearchParams();
                                if (dept !== 'all') params.set('dept', dept);
                                if (search.trim()) params.set('search', search.trim());
                                if (dateFrom) params.set('dateFrom', dateFrom);
                                if (dateTo) params.set('dateTo', dateTo);

                                const res = await fetch(`/api/export?${params.toString()}`, {
                                    headers: { 'Authorization': `Bearer ${token}` }
                                });

                                if (!res.ok) throw new Error('Export failed');

                                const blob = await res.blob();
                                const url = window.URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `archive_export_${new Date().toISOString().slice(0, 10)}.csv`;
                                document.body.appendChild(a);
                                a.click();
                                window.URL.revokeObjectURL(url);
                                document.body.removeChild(a);
                            } catch (error) {
                                console.error('Export error:', error);
                                alert('Failed to export. Please try again.');
                            } finally {
                                setIsExporting(false);
                            }
                        }}
                        disabled={isExporting}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border mr-2 shadow-sm ${isExporting
                                ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                                : 'bg-brand-50 dark:bg-brand-900/40 hover:bg-brand-100 dark:hover:bg-brand-800 text-brand-700 dark:text-brand-300 border-brand-200 dark:border-brand-700/50'
                            }`}
                        title={t('export_csv')}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        {isExporting ? 'Exporting...' : t('export_csv')}
                    </button>
                    <input
                        type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search agent, CDBID, Dare Ref, expert…"
                        className="border border-gray-200 dark:border-brand-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-56 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                    <div className="flex gap-1">
                        {['all', 'DSC', 'FOT'].map((d) => (
                            <button key={d} onClick={() => setDept(d)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${dept === d ? 'bg-brand-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                                {d === 'all' ? 'All' : d}
                            </button>
                        ))}
                    </div>
                    {allLabels.length > 0 && (
                        <select
                            value={labelFilter}
                            onChange={(e) => setLabelFilter(e.target.value)}
                            className="border border-gray-200 dark:border-brand-600 rounded-lg px-2 py-1.5 text-xs font-medium bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                        >
                            <option value="all">All labels</option>
                            <option value="none">No label</option>
                            <option value="any">Has label</option>
                            {allLabels.map(l => (
                                <option key={l.id} value={l.id}>{l.text}</option>
                            ))}
                        </select>
                    )}
                    <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                        className="border border-gray-200 dark:border-brand-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500" />
                    <span className="text-gray-400 text-xs">→</span>
                    <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                        className="border border-gray-200 dark:border-brand-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500" />
                    {(dateFrom || dateTo) && (
                        <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-xs text-gray-400 hover:text-brand-500 transition-colors">✕ Clear dates</button>
                    )}
                </div>

                <div className="bg-white dark:bg-brand-800 rounded-xl shadow-sm border border-gray-100 dark:border-brand-700 overflow-hidden">
                    <div className="overflow-x-auto">
                        {tickets.length === 0 && !loading ? (
                            <p className="text-center text-gray-400 py-12 text-sm">No results.</p>
                        ) : (
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 z-10 bg-white dark:bg-brand-800">
                                    <tr className="border-b border-gray-100 dark:border-brand-700 text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
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
                                    {tickets.filter(ticket => {
                                        if (labelFilter === 'all') return true;
                                        if (labelFilter === 'none') return !ticket.labels || ticket.labels.length === 0;
                                        if (labelFilter === 'any') return ticket.labels && ticket.labels.length > 0;
                                        return ticket.labels && ticket.labels.includes(labelFilter);
                                    }).map((ticket) => (
                                        <tr
                                            key={ticket.id}
                                            onClick={() => setPreview(preview?.id === ticket.id ? null : ticket)}
                                            className={`cursor-pointer transition-colors ${preview?.id === ticket.id ? 'bg-brand-50 dark:bg-brand-900/20' : 'hover:bg-gray-50 dark:hover:bg-brand-700'}`}
                                        >
                                            <td className="px-4 py-2.5">
                                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${DEPT_COLOR[ticket.dept]}`}>{ticket.dept}</span>
                                            </td>
                                            <td className="px-4 py-2.5 font-medium text-gray-800 dark:text-gray-100">{ticket.agentName}</td>
                                            <td className="px-4 py-2.5 font-mono text-xs text-brand-600 dark:text-brand-400">
                                                {ticket.cdbId ? `CDBID: ${ticket.cdbId}` : ticket.dareRef ? `Dare Ref: ${ticket.dareRef}` : '—'}
                                            </td>
                                            <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{ticket.expertName || <span className="italic text-gray-300">Abandoned</span>}</td>
                                            <td className="px-4 py-2.5">
                                                {ticket.labels && ticket.labels.length > 0 ? (
                                                    <div className="flex flex-wrap gap-1">
                                                        {ticket.labels.map(id => {
                                                            const info = allLabels.find(l => l.id === id);
                                                            if (!info) return null;
                                                            return (
                                                                <span key={id} className={`text-[10px] font-bold px-1.5 py-0.5 rounded bg-${info.color}-100 text-${info.color}-700 dark:bg-${info.color}-900/30 dark:text-${info.color}-400`}>
                                                                    {info.text}
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                ) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                                            </td>
                                            <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{duration(ticket)}</td>
                                            <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{fmt(ticket.createdAt)}</td>
                                            <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{fmt(ticket.closedAt)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                    <div className="px-4 py-3 border-t border-gray-100 dark:border-brand-700 flex items-center justify-between shrink-0">
                        <span className="text-xs text-gray-400">{tickets.length} of {total} chats</span>
                        {tickets.length < total && (
                            <button
                                onClick={() => fetchTickets({ off: offset })}
                                disabled={loading}
                                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-brand-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-brand-700 disabled:opacity-40 transition-colors"
                            >
                                {loading ? 'Loading…' : `Load more (${total - tickets.length} remaining)`}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <ArchiveDrawer
                preview={preview}
                messages={messages}
                allLabels={allLabels}
                onClose={() => setPreview(null)}
                duration={duration}
                DEPT_COLOR={DEPT_COLOR}
            />
        </div>
    );
}

import { useState } from 'react';
import { trpc } from '../../utils/trpc';

const LIMIT = 50;

type SubTab = 'audit' | 'tickets';

export default function PlatformArchiveViewer() {
  const [subTab, setSubTab] = useState<SubTab>('audit');

  return (
    <div>
      <div className="flex items-center gap-4 mb-6 border-b-4 border-black dark:border-white pb-4">
        <h2 className="text-4xl font-black uppercase tracking-tighter mr-auto">Archive</h2>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 mb-6">
        {(['audit', 'tickets'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={`px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 ${
              subTab === tab
                ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white'
                : 'border-black/20 dark:border-white/20 hover:border-black dark:hover:border-white'
            }`}
          >
            {tab === 'audit' ? 'Audit Log Archive' : 'Ticket Archive'}
          </button>
        ))}
      </div>

      {subTab === 'audit' ? <AuditArchivePanel /> : <TicketArchivePanel />}
    </div>
  );
}

/* ─── Audit Archive Panel ─── */
function AuditArchivePanel() {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [allItems, setAllItems] = useState<any[]>([]);
  const [actionFilter, setActionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const query = trpc.platform.getArchivedAuditLog.useQuery({
    limit: LIMIT,
    cursor,
    action: actionFilter || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const chainQuery = trpc.platform.verifyAuditChain.useQuery(undefined, { enabled: false });
  const archiveMutation = trpc.platform.runArchive.useMutation();

  // Accumulate results
  const data = query.data as { items?: any[]; nextCursor?: string } | undefined;
  if (data?.items && data.items.length > 0) {
    const lastId = allItems[allItems.length - 1]?.id;
    const newLastId = data.items[data.items.length - 1]?.id;
    if (lastId !== newLastId) {
      // This is a side-effect in render, but React will reconcile. Use effect pattern if needed.
    }
  }

  // We'll use a simpler approach with useEffect-like state sync
  const items = !cursor ? (data?.items || []) : [...allItems.filter(i => !data?.items?.find((d: any) => d.id === i.id)), ...(data?.items || [])];
  const nextCursor = data?.nextCursor || '';

  function resetAndReload() {
    setCursor(undefined);
    setAllItems([]);
  }

  function fmt(iso?: string) {
    return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  }

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input
          type="text"
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); resetAndReload(); }}
          placeholder="Filter by action…"
          className="border-2 border-black dark:border-white px-3 py-1.5 text-sm font-bold bg-transparent outline-none w-52"
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); resetAndReload(); }}
          className="border-2 border-black dark:border-white px-2 py-1.5 text-sm bg-transparent outline-none"
        />
        <span className="text-xs font-black">→</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); resetAndReload(); }}
          className="border-2 border-black dark:border-white px-2 py-1.5 text-sm bg-transparent outline-none"
        />
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => chainQuery.refetch()}
            disabled={chainQuery.isFetching}
            className="px-3 py-2 border-2 border-black dark:border-white text-[10px] font-black uppercase tracking-widest disabled:opacity-30"
          >
            {chainQuery.isFetching ? 'Verifying…' : 'Verify Chain'}
          </button>
          <button
            onClick={() => archiveMutation.mutate()}
            disabled={archiveMutation.isPending}
            className="px-3 py-2 border-2 border-black dark:border-white text-[10px] font-black uppercase tracking-widest disabled:opacity-30"
          >
            {archiveMutation.isPending ? 'Running…' : 'Run Archive Now'}
          </button>
        </div>
      </div>

      {/* Chain verification result */}
      {chainQuery.data && (
        <div className={`mb-4 border-2 px-4 py-3 text-sm font-bold ${
          chainQuery.data.valid
            ? 'border-green-600 text-green-700 dark:text-green-400'
            : 'border-red-600 text-red-700 dark:text-red-400'
        }`}>
          {chainQuery.data.valid
            ? `✓ Chain integrity verified — ${chainQuery.data.checked} entries checked`
            : `✕ Chain broken at entry ${chainQuery.data.brokenAt} — ${chainQuery.data.checked} entries checked`}
        </div>
      )}

      {/* Archive run result */}
      {archiveMutation.data && (
        <div className="mb-4 border-2 border-black dark:border-white px-4 py-3 text-sm font-bold">
          Archive complete — {archiveMutation.data.auditCount} audit entries, {archiveMutation.data.ticketCount} tickets archived
        </div>
      )}

      {/* Table */}
      <div className="border-2 border-black dark:border-white overflow-hidden">
        <div className="overflow-x-auto">
          {items.length === 0 && !query.isFetching ? (
            <p className="text-center text-[10px] font-black uppercase opacity-50 py-12">No archived audit entries.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-black dark:border-white bg-black/5 dark:bg-white/5 text-left text-[10px] font-black uppercase tracking-widest">
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Archived</th>
                  <th className="px-4 py-3">Chain Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/20 dark:divide-white/20">
                {items.map((entry: any) => (
                  <tr key={entry.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                    <td className="px-4 py-2.5">
                      <span className="text-[10px] font-black uppercase border border-black dark:border-white px-1.5 py-0.5">{entry.action}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs opacity-60">{entry.actorId || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs opacity-60">
                      {entry.targetType ? `${entry.targetType}:${entry.targetId || ''}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs opacity-60 whitespace-nowrap">{fmt(entry.createdAt)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs opacity-60 whitespace-nowrap">{fmt(entry.archivedAt)}</td>
                    <td className="px-4 py-2.5 font-mono text-[9px] opacity-40 max-w-[120px] truncate" title={entry.chainHash}>
                      {entry.chainHash?.slice(0, 16)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 py-3 border-t border-black/20 dark:border-white/20 flex items-center justify-between">
          <span className="text-[10px] font-black uppercase opacity-60">{items.length} entries loaded</span>
          {nextCursor && (
            <button
              onClick={() => { setAllItems(items); setCursor(nextCursor); }}
              disabled={query.isFetching}
              className="text-[10px] font-black uppercase tracking-widest border border-black dark:border-white px-3 py-1.5 disabled:opacity-30"
            >
              {query.isFetching ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Ticket Archive Panel ─── */
function TicketArchivePanel() {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [allItems, setAllItems] = useState<any[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const query = trpc.platform.getArchivedTickets.useQuery({
    limit: LIMIT,
    cursor,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const data = query.data as { items?: any[]; nextCursor?: string } | undefined;
  const items = !cursor ? (data?.items || []) : [...allItems.filter(i => !data?.items?.find((d: any) => d.id === i.id)), ...(data?.items || [])];
  const nextCursor = data?.nextCursor || '';

  function resetAndReload() {
    setCursor(undefined);
    setAllItems([]);
  }

  function fmt(iso?: string) {
    return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  }

  function duration(createdAt?: string, closedAt?: string) {
    if (!closedAt || !createdAt) return '—';
    const m = Math.round((new Date(closedAt).getTime() - new Date(createdAt).getTime()) / 60000);
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); resetAndReload(); }}
          className="border-2 border-black dark:border-white px-2 py-1.5 text-sm bg-transparent outline-none"
        />
        <span className="text-xs font-black">→</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); resetAndReload(); }}
          className="border-2 border-black dark:border-white px-2 py-1.5 text-sm bg-transparent outline-none"
        />
        {(dateFrom || dateTo) && (
          <button
            onClick={() => { setDateFrom(''); setDateTo(''); resetAndReload(); }}
            className="text-[10px] font-black uppercase tracking-widest border border-black dark:border-white px-2 py-1"
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="border-2 border-black dark:border-white overflow-hidden">
        <div className="overflow-x-auto">
          {items.length === 0 && !query.isFetching ? (
            <p className="text-center text-[10px] font-black uppercase opacity-50 py-12">No archived tickets.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-black dark:border-white bg-black/5 dark:bg-white/5 text-left text-[10px] font-black uppercase tracking-widest">
                  <th className="px-4 py-3">Dept</th>
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">Support</th>
                  <th className="px-4 py-3">Messages</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Closed</th>
                  <th className="px-4 py-3">Archived</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/20 dark:divide-white/20">
                {items.map((ticket: any) => (
                  <tr key={ticket.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                    <td className="px-4 py-2.5">
                      <span className="text-[10px] font-black uppercase border border-black dark:border-white px-1.5 py-0.5">{ticket.dept}</span>
                    </td>
                    <td className="px-4 py-2.5 font-bold">{ticket.agentName}</td>
                    <td className="px-4 py-2.5 opacity-60">{ticket.supportName || <span className="italic">—</span>}</td>
                    <td className="px-4 py-2.5 font-mono text-xs opacity-60">{ticket.messageCount ?? '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs opacity-60">{duration(ticket.createdAt, ticket.closedAt)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs opacity-60 whitespace-nowrap">{fmt(ticket.createdAt)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs opacity-60 whitespace-nowrap">{fmt(ticket.closedAt)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs opacity-60 whitespace-nowrap">{fmt(ticket.archivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 py-3 border-t border-black/20 dark:border-white/20 flex items-center justify-between">
          <span className="text-[10px] font-black uppercase opacity-60">{items.length} tickets loaded</span>
          {nextCursor && (
            <button
              onClick={() => { setAllItems(items); setCursor(nextCursor); }}
              disabled={query.isFetching}
              className="text-[10px] font-black uppercase tracking-widest border border-black dark:border-white px-3 py-1.5 disabled:opacity-30"
            >
              {query.isFetching ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

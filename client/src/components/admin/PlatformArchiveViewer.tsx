import { useState } from 'react';
import { trpc } from '../../utils/trpc';

const LIMIT = 50;

type SubTab = 'audit' | 'tickets';

interface AuditArchiveEntry {
  id: string;
  action: string;
  actorId: string | null;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
  archivedAt: string;
  chainHash: string;
  metadata?: Record<string, unknown>;
}

interface ArchivedTicket {
  id: string;
  partnerId: string;
  dept: string;
  agentName: string;
  supportName: string | null;
  messageCount: number | null;
  createdAt: string;
  closedAt: string | null;
  archivedAt: string;
}

export default function PlatformArchiveViewer() {
  const [subTab, setSubTab] = useState<SubTab>('audit');

  return (
    <div>
      <div className="flex items-center gap-4 mb-6 border-b border-[var(--color-border)] pb-4">
        <h2 className="text-2xl font-bold uppercase tracking-tight mr-auto">Archive</h2>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 mb-6">
        {(['audit', 'tickets'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={`px-6 py-2 font-mono text-[10px] font-bold uppercase tracking-wide border ${
              subTab === tab
                ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)] border-[var(--color-border)]'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
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

/* --- Audit Archive Panel --- */
function AuditArchivePanel() {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [allItems, setAllItems] = useState<AuditArchiveEntry[]>([]);
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
  const data = query.data as { items?: AuditArchiveEntry[]; nextCursor?: string } | undefined;
  if (data?.items && data.items.length > 0) {
    const lastId = allItems[allItems.length - 1]?.id;
    const newLastId = data.items[data.items.length - 1]?.id;
    if (lastId !== newLastId) {
      // This is a side-effect in render, but React will reconcile. Use effect pattern if needed.
    }
  }

  // We'll use a simpler approach with useEffect-like state sync
  const items = !cursor ? (data?.items || []) : [...allItems.filter(i => !data?.items?.find((d: AuditArchiveEntry) => d.id === i.id)), ...(data?.items || [])];
  const nextCursor = data?.nextCursor || '';

  function resetAndReload() {
    setCursor(undefined);
    setAllItems([]);
  }

  function fmt(iso?: string | null) {
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
          className="input-field w-52"
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); resetAndReload(); }}
          className="input-field"
        />
        <span className="text-xs font-bold text-[var(--color-text-muted)]">→</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); resetAndReload(); }}
          className="input-field"
        />
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => chainQuery.refetch()}
            disabled={chainQuery.isFetching}
            className="btn-secondary disabled:opacity-30"
          >
            {chainQuery.isFetching ? 'Verifying…' : 'Verify Chain'}
          </button>
          <button
            onClick={() => archiveMutation.mutate()}
            disabled={archiveMutation.isPending}
            className="btn-secondary disabled:opacity-30"
          >
            {archiveMutation.isPending ? 'Running…' : 'Run Archive Now'}
          </button>
        </div>
      </div>

      {/* Chain verification result */}
      {chainQuery.data && (
        <div className={`mb-4 border px-4 py-3 text-sm font-bold ${
          chainQuery.data.valid
            ? 'border-green-600 text-green-700 dark:text-green-400'
            : 'border-red-600 text-red-700 dark:text-red-400'
        }`}>
          {chainQuery.data.valid
            ? `Chain integrity verified — ${chainQuery.data.checked} entries checked`
            : `Chain broken at entry ${chainQuery.data.brokenAt} — ${chainQuery.data.checked} entries checked`}
        </div>
      )}

      {/* Archive run result */}
      {archiveMutation.data && (
        <div className="mb-4 border border-[var(--color-border)] px-4 py-3 text-sm font-bold">
          Archive complete — {archiveMutation.data.auditCount} audit entries, {archiveMutation.data.ticketCount} tickets archived
        </div>
      )}

      {/* Table */}
      <div className="surface-card overflow-hidden">
        <div className="overflow-x-auto">
          {items.length === 0 && !query.isFetching ? (
            <p className="text-center font-mono text-[9px] font-bold uppercase text-[var(--color-text-muted)] py-12">No archived audit entries.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-bg-elevated text-left">
                  <th className="px-4 py-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Action</th>
                  <th className="px-4 py-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Actor</th>
                  <th className="px-4 py-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Target</th>
                  <th className="px-4 py-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Created</th>
                  <th className="px-4 py-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Archived</th>
                  <th className="px-4 py-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Chain Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {items.map((entry: AuditArchiveEntry) => (
                  <tr key={entry.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5">
                      <span className="text-[10px] font-bold uppercase border border-[var(--color-border)] px-1.5 py-0.5">{entry.action}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-text-secondary)]">{entry.actorId || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-text-secondary)]">
                      {entry.targetType ? `${entry.targetType}:${entry.targetId || ''}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-text-secondary)] whitespace-nowrap">{fmt(entry.createdAt)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-text-secondary)] whitespace-nowrap">{fmt(entry.archivedAt)}</td>
                    <td className="px-4 py-2.5 font-mono text-[9px] text-[var(--color-text-muted)] max-w-[120px] truncate" title={entry.chainHash}>
                      {entry.chainHash?.slice(0, 16)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-between">
          <span className="font-mono text-[9px] font-bold uppercase text-[var(--color-text-muted)]">{items.length} entries loaded</span>
          {nextCursor && (
            <button
              onClick={() => { setAllItems(items); setCursor(nextCursor); }}
              disabled={query.isFetching}
              className="btn-secondary disabled:opacity-30"
            >
              {query.isFetching ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* --- Ticket Archive Panel --- */
function TicketArchivePanel() {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [allItems, setAllItems] = useState<ArchivedTicket[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const query = trpc.platform.getArchivedTickets.useQuery({
    limit: LIMIT,
    cursor,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const data = query.data as { items?: ArchivedTicket[]; nextCursor?: string } | undefined;
  const items = !cursor ? (data?.items || []) : [...allItems.filter(i => !data?.items?.find((d: ArchivedTicket) => d.id === i.id)), ...(data?.items || [])];
  const nextCursor = data?.nextCursor || '';

  function resetAndReload() {
    setCursor(undefined);
    setAllItems([]);
  }

  function fmt(iso?: string | null) {
    return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  }

  function duration(createdAt?: string | null, closedAt?: string | null) {
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
          className="input-field"
        />
        <span className="text-xs font-bold text-[var(--color-text-muted)]">→</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); resetAndReload(); }}
          className="input-field"
        />
        {(dateFrom || dateTo) && (
          <button
            onClick={() => { setDateFrom(''); setDateTo(''); resetAndReload(); }}
            className="btn-secondary"
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="surface-card overflow-hidden">
        <div className="overflow-x-auto">
          {items.length === 0 && !query.isFetching ? (
            <p className="text-center font-mono text-[9px] font-bold uppercase text-[var(--color-text-muted)] py-12">No archived tickets.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-bg-elevated text-left">
                  <th className="px-4 py-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Dept</th>
                  <th className="px-4 py-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Agent</th>
                  <th className="px-4 py-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Support</th>
                  <th className="px-4 py-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Messages</th>
                  <th className="px-4 py-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Duration</th>
                  <th className="px-4 py-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Created</th>
                  <th className="px-4 py-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Closed</th>
                  <th className="px-4 py-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Archived</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {items.map((ticket: ArchivedTicket) => (
                  <tr key={ticket.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5">
                      <span className="text-[10px] font-bold uppercase border border-[var(--color-border)] px-1.5 py-0.5">{ticket.dept}</span>
                    </td>
                    <td className="px-4 py-2.5 font-bold">{ticket.agentName}</td>
                    <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{ticket.supportName || <span className="italic">—</span>}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-text-secondary)]">{ticket.messageCount ?? '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-text-secondary)]">{duration(ticket.createdAt, ticket.closedAt)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-text-secondary)] whitespace-nowrap">{fmt(ticket.createdAt)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-text-secondary)] whitespace-nowrap">{fmt(ticket.closedAt)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-text-secondary)] whitespace-nowrap">{fmt(ticket.archivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-between">
          <span className="font-mono text-[9px] font-bold uppercase text-[var(--color-text-muted)]">{items.length} tickets loaded</span>
          {nextCursor && (
            <button
              onClick={() => { setAllItems(items); setCursor(nextCursor); }}
              disabled={query.isFetching}
              className="btn-secondary disabled:opacity-30"
            >
              {query.isFetching ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState, useMemo, useEffect, useCallback } from 'react';
import { trpc } from '../../utils/trpc';

const LIMIT = 50;
const DEBOUNCE_MS = 500;
const MAX_ACCUMULATED_ITEMS = 500;

type SubTab = 'audit' | 'tickets';

interface AuditArchiveEntry {
  id: string;
  action: string;
  actorId: string | null;
  partnerId: string | null;
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
  agentId: string | null;
  supportId: string | null;
  agentName: string | null;
  supportName: string | null;
  status: string;
  messageCount: number | null;
  createdAt: string;
  closedAt: string | null;
  archivedAt: string;
}

const CARD = 'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)]';
const INPUT = 'h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';
const COL_HEAD = 'px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]';
const SECONDARY_BTN = 'h-9 px-4 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[var(--color-ink)] text-[13px] font-medium transition-colors disabled:opacity-40';

function usePartnerList() {
  const { data } = trpc.platform.listPartners.useQuery();
  const partnerList = useMemo(() => (data ?? []) as { id: string; name: string }[], [data]);
  const partnerNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of partnerList) map[p.id] = p.name;
    return map;
  }, [partnerList]);
  return { partnerList, partnerNameMap };
}

function fmt(iso?: string | null) {
  return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

export default function PlatformArchiveViewer() {
  const [subTab, setSubTab] = useState<SubTab>('audit');

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">Archive</h2>
          <p className="text-[13px] text-[var(--color-ink-muted)] mt-1">Tamper-evident audit log + closed tickets</p>
        </div>
        <div className="ml-auto inline-flex gap-1 p-1 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)]">
          {(['audit', 'tickets'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setSubTab(tab)}
              className={`px-3 py-1 rounded-[var(--radius-pill)] text-[12px] font-medium transition-colors ${
                subTab === tab
                  ? 'bg-[var(--color-bg-surface)] text-[var(--color-ink)] shadow-[var(--shadow-soft)]'
                  : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              {tab === 'audit' ? 'Audit Log Archive' : 'Ticket Archive'}
            </button>
          ))}
        </div>
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
  const [debouncedAction, setDebouncedAction] = useState('');
  const [partnerFilter, setPartnerFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { partnerList, partnerNameMap } = usePartnerList();

  const resetAndReload = useCallback(() => {
    setCursor(undefined);
    setAllItems([]);
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedAction(actionFilter);
      resetAndReload();
    }, DEBOUNCE_MS);
    return () => clearTimeout(handler);
  }, [actionFilter, resetAndReload]);

  const query = trpc.platform.getArchivedAuditLog.useQuery({
    limit: LIMIT,
    cursor,
    action: debouncedAction || undefined,
    partnerId: partnerFilter || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const chainQuery = trpc.platform.verifyAuditChain.useMutation();
  const archiveMutation = trpc.platform.runArchive.useMutation();

  const data = query.data as { items?: AuditArchiveEntry[]; nextCursor?: string } | undefined;
  const items = !cursor ? (data?.items || []) : [...allItems.filter(i => !data?.items?.find((d: AuditArchiveEntry) => d.id === i.id)), ...(data?.items || [])].slice(-MAX_ACCUMULATED_ITEMS);
  const nextCursor = data?.nextCursor || '';

  const hasFilters = actionFilter || partnerFilter || dateFrom || dateTo;

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input
          type="text"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          placeholder="Filter by action…"
          className={`${INPUT} w-52`}
        />
        <select
          value={partnerFilter}
          onChange={(e) => { setPartnerFilter(e.target.value); resetAndReload(); }}
          className={`${INPUT} w-48`}
        >
          <option value="">All partners</option>
          {partnerList.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); resetAndReload(); }}
          className={INPUT}
        />
        <span className="text-[12px] text-[var(--color-ink-muted)]">→</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); resetAndReload(); }}
          className={INPUT}
        />
        {hasFilters && (
          <button
            onClick={() => { setActionFilter(''); setDebouncedAction(''); setPartnerFilter(''); setDateFrom(''); setDateTo(''); resetAndReload(); }}
            className={SECONDARY_BTN}
          >
            Clear
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button onClick={() => chainQuery.mutate()} disabled={chainQuery.isPending} className={SECONDARY_BTN}>
            {chainQuery.isPending ? 'Verifying…' : 'Verify Chain'}
          </button>
          <button onClick={() => archiveMutation.mutate()} disabled={archiveMutation.isPending} className={SECONDARY_BTN}>
            {archiveMutation.isPending ? 'Running…' : 'Run Archive Now'}
          </button>
        </div>
      </div>

      {/* Chain verification result */}
      {chainQuery.data && (
        <div className={`mb-4 rounded-[var(--radius-card)] px-4 py-3 text-[13px] font-medium flex items-start gap-2.5 ${
          chainQuery.data.valid
            ? 'bg-[color-mix(in_srgb,var(--color-ok)_14%,transparent)] text-[var(--color-ok)]'
            : 'bg-[var(--color-urgent-soft)] text-[var(--color-urgent)]'
        }`}>
          <span className={`mt-1 inline-block w-1.5 h-1.5 rounded-full shrink-0 ${chainQuery.data.valid ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-urgent)]'}`} />
          <span>
            {chainQuery.data.valid
              ? `Chain integrity verified — ${chainQuery.data.checked} entries checked`
              : `Chain broken at entry ${chainQuery.data.brokenAt} — ${chainQuery.data.checked} entries checked`}
          </span>
        </div>
      )}

      {/* Archive run result */}
      {archiveMutation.data && (
        <div className="mb-4 rounded-[var(--radius-card)] bg-[var(--color-accent-soft)] px-4 py-3 text-[13px] font-medium text-[var(--color-accent)]">
          Archive complete — {archiveMutation.data.auditCount} audit entries, {archiveMutation.data.ticketCount} tickets archived
        </div>
      )}

      {/* Table */}
      <div className={`${CARD} overflow-hidden`}>
        <div className="overflow-x-auto">
          {items.length === 0 && !query.isFetching ? (
            <p className="text-center text-[13px] text-[var(--color-ink-muted)] py-12">No archived audit entries.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  <th className={COL_HEAD}>Action</th>
                  <th className={COL_HEAD}>Partner</th>
                  <th className={COL_HEAD}>Actor</th>
                  <th className={COL_HEAD}>Target Type</th>
                  <th className={COL_HEAD}>Target ID</th>
                  <th className={COL_HEAD}>Created</th>
                  <th className={COL_HEAD}>Archived</th>
                  <th className={COL_HEAD}>Chain Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {items.map((entry: AuditArchiveEntry) => (
                  <tr key={entry.id} className="hover:bg-[var(--color-hover)] transition-colors">
                    <td className="px-4 py-2.5">
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] text-[var(--color-ink)]">{entry.action}</span>
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-[var(--color-ink-soft)]">{entry.partnerId ? (partnerNameMap[entry.partnerId] || entry.partnerId) : '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-[var(--color-ink-soft)]">{entry.actorId || '—'}</td>
                    <td className="px-4 py-2.5 text-[12px] text-[var(--color-ink-soft)]">{entry.targetType || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-[var(--color-ink-soft)]">{entry.targetId || '—'}</td>
                    <td className="px-4 py-2.5 text-[12px] text-[var(--color-ink-muted)] tabular-nums whitespace-nowrap">{fmt(entry.createdAt)}</td>
                    <td className="px-4 py-2.5 text-[12px] text-[var(--color-ink-muted)] tabular-nums whitespace-nowrap">{fmt(entry.archivedAt)}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-[var(--color-ink-muted)] max-w-[140px] truncate" title={entry.chainHash}>
                      {entry.chainHash?.slice(0, 16)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-between">
          <span className="text-[12px] text-[var(--color-ink-muted)] tabular-nums">{items.length} entries loaded</span>
          {nextCursor && (
            <button
              onClick={() => { setAllItems(items); setCursor(nextCursor); }}
              disabled={query.isFetching}
              className={SECONDARY_BTN}
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
  const [partnerFilter, setPartnerFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [debouncedDept, setDebouncedDept] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { partnerList, partnerNameMap } = usePartnerList();

  const resetAndReload = useCallback(() => {
    setCursor(undefined);
    setAllItems([]);
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedDept(deptFilter);
      resetAndReload();
    }, DEBOUNCE_MS);
    return () => clearTimeout(handler);
  }, [deptFilter, resetAndReload]);

  const query = trpc.platform.getArchivedTickets.useQuery({
    limit: LIMIT,
    cursor,
    partnerId: partnerFilter || undefined,
    dept: debouncedDept || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const data = query.data as { items?: ArchivedTicket[]; nextCursor?: string } | undefined;
  const items = !cursor ? (data?.items || []) : [...allItems.filter(i => !data?.items?.find((d: ArchivedTicket) => d.id === i.id)), ...(data?.items || [])].slice(-MAX_ACCUMULATED_ITEMS);
  const nextCursor = data?.nextCursor || '';

  function duration(createdAt?: string | null, closedAt?: string | null) {
    if (!closedAt || !createdAt) return '—';
    const m = Math.round((new Date(closedAt).getTime() - new Date(createdAt).getTime()) / 60000);
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  const hasFilters = partnerFilter || deptFilter || dateFrom || dateTo;

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select
          value={partnerFilter}
          onChange={(e) => { setPartnerFilter(e.target.value); resetAndReload(); }}
          className={`${INPUT} w-48`}
        >
          <option value="">All partners</option>
          {partnerList.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <input
          type="text"
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          placeholder="Filter by dept…"
          className={`${INPUT} w-44`}
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); resetAndReload(); }}
          className={INPUT}
        />
        <span className="text-[12px] text-[var(--color-ink-muted)]">→</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); resetAndReload(); }}
          className={INPUT}
        />
        {hasFilters && (
          <button
            onClick={() => { setPartnerFilter(''); setDeptFilter(''); setDebouncedDept(''); setDateFrom(''); setDateTo(''); resetAndReload(); }}
            className={SECONDARY_BTN}
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className={`${CARD} overflow-hidden`}>
        <div className="overflow-x-auto">
          {items.length === 0 && !query.isFetching ? (
            <p className="text-center text-[13px] text-[var(--color-ink-muted)] py-12">No archived tickets.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  <th className={COL_HEAD}>Partner</th>
                  <th className={COL_HEAD}>Dept</th>
                  <th className={COL_HEAD}>Agent</th>
                  <th className={COL_HEAD}>Support</th>
                  <th className={COL_HEAD}>Messages</th>
                  <th className={COL_HEAD}>Duration</th>
                  <th className={COL_HEAD}>Created</th>
                  <th className={COL_HEAD}>Closed</th>
                  <th className={COL_HEAD}>Archived</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {items.map((ticket: ArchivedTicket) => (
                  <tr key={ticket.id} className="hover:bg-[var(--color-hover)] transition-colors">
                    <td className="px-4 py-2.5 text-[12px] text-[var(--color-ink-soft)]">{partnerNameMap[ticket.partnerId] || ticket.partnerId}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] text-[var(--color-ink-soft)]">{ticket.dept}</span>
                    </td>
                    <td className="px-4 py-2.5 text-[13px] font-medium text-[var(--color-ink)]">{ticket.agentName || <span className="font-mono text-[11px] text-[var(--color-ink-muted)]">{ticket.agentId ?? '—'}</span>}</td>
                    <td className="px-4 py-2.5 text-[13px] text-[var(--color-ink-soft)]">{ticket.supportName || <span className="italic text-[var(--color-ink-muted)]">—</span>}</td>
                    <td className="px-4 py-2.5 text-[12px] text-[var(--color-ink-soft)] tabular-nums">{ticket.messageCount ?? '—'}</td>
                    <td className="px-4 py-2.5 text-[12px] text-[var(--color-ink-soft)] tabular-nums">{duration(ticket.createdAt, ticket.closedAt)}</td>
                    <td className="px-4 py-2.5 text-[12px] text-[var(--color-ink-muted)] tabular-nums whitespace-nowrap">{fmt(ticket.createdAt)}</td>
                    <td className="px-4 py-2.5 text-[12px] text-[var(--color-ink-muted)] tabular-nums whitespace-nowrap">{fmt(ticket.closedAt)}</td>
                    <td className="px-4 py-2.5 text-[12px] text-[var(--color-ink-muted)] tabular-nums whitespace-nowrap">{fmt(ticket.archivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-between">
          <span className="text-[12px] text-[var(--color-ink-muted)] tabular-nums">{items.length} tickets loaded</span>
          {nextCursor && (
            <button
              onClick={() => { setAllItems(items); setCursor(nextCursor); }}
              disabled={query.isFetching}
              className={SECONDARY_BTN}
            >
              {query.isFetching ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState, useCallback, useEffect, useMemo } from 'react';
import { trpc } from '../../utils/trpc';
import Toast from '../Toast';
import AuditMetadataDrawer, { type AuditEntry } from './AuditMetadataDrawer';
import { useUrlParam } from '../../hooks/useUrlState';
import { auditSeverity, severityRowClass } from '../../utils/auditSeverity';
import Button from '../ui/Button';
import SectionLabel from '../ui/SectionLabel';

function formatDetails(log: { action: string; metadata?: unknown; targetId: string | null }) {
  const metadata = (log.metadata && typeof log.metadata === 'object') ? log.metadata as Record<string, unknown> : {};
  switch (log.action) {
    case 'member.added':
      return `Added ${String(metadata.email || log.targetId || '-')}`;
    case 'member.invited':
      return `Invited ${String(metadata.email || log.targetId || '-')}`;
    case 'member.removed': {
      const ext = metadata.wasExternal === true ? ' (guest)' : '';
      return `Removed membership${ext}`;
    }
    case 'member.updated':
      return `Role ${String(metadata.oldRole || '?')} -> ${String(metadata.newRole || '?')}`;
    case 'partner.config_updated':
      return 'Tenant configuration updated';
    case 'label.created':
      return `Label: ${String(metadata.name || '-')}`;
    case 'kb.created':
      return `KB article: ${String(metadata.title || '-')}`;
    case 'webhook.created':
      return `Webhook: ${String(metadata.url || '-')}`;
    case 'sso.membership_auto_created':
      return `SSO auto-created membership (${String(metadata.role || '?')})`;
    case 'sso.role_synced':
      return `SSO role ${String(metadata.oldRole || '?')} -> ${String(metadata.newRole || '?')}`;
    case 'sso.membership_revoked':
      return `SSO revoked membership — ${String(metadata.reason || '')}`;
    default:
      return JSON.stringify(metadata);
  }
}

const inputClass =
  'w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 text-[13px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus:border-[var(--color-accent)] transition-colors';

export default function AdminAuditLog() {
  const LIMIT = 50;
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [filterAction, setFilterAction] = useUrlParam('action', '', 'a');
  const [filterActorId, setFilterActorId] = useUrlParam('actor', '', 'a');
  const [filterTargetType, setFilterTargetType] = useUrlParam('ttype', '', 'a');
  const [filterTargetId, setFilterTargetId] = useUrlParam('tid', '', 'a');
  const [debouncedTargetId, setDebouncedTargetId] = useState(() => filterTargetId);
  const [filterWasExternalStr, setFilterWasExternalStr] = useUrlParam('guest', '', 'a');
  const filterWasExternal = filterWasExternalStr === '1';
  const setFilterWasExternal = useCallback(
    (v: boolean) => setFilterWasExternalStr(v ? '1' : ''),
    [setFilterWasExternalStr],
  );
  const [dateFrom, setDateFrom] = useUrlParam('from', '', 'a');
  const [dateTo, setDateTo] = useUrlParam('to', '', 'a');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
  const [openId, setOpenId] = useUrlParam('open', '', 'a');

  const resetCursor = useCallback(() => {
    setCursor(undefined);
    setCursorStack([]);
  }, []);

  // Reset pagination cursor whenever any filter input changes — ensures the
  // next query starts from page 1 instead of a stale cursor.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    resetCursor();
  }, [filterAction, filterActorId, filterTargetType, filterWasExternal, dateFrom, dateTo, resetCursor]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedTargetId(filterTargetId);
      resetCursor();
    }, 500);
    return () => clearTimeout(handler);
  }, [filterTargetId, resetCursor]);

  const { data: actionList } = trpc.partner.audit.listActions.useQuery();
  const { data: targetTypeList } = trpc.partner.audit.listTargetTypes.useQuery();

  const verifyChain = trpc.partner.audit.verifyChain.useMutation({
    onSuccess: (r) => {
      if (r.error) {
        setToast({ message: `Chain verify failed: ${r.error}`, type: 'error' });
        return;
      }
      if (!r.valid) {
        const where = r.brokenInScope
          ? `in your tenant (row ${r.brokenAt})`
          : 'outside your tenant';
        setToast({ message: `Chain broken ${where} — ${r.partnerChecked} of your rows checked`, type: 'error' });
        return;
      }
      setToast({ message: `Chain OK — ${r.partnerChecked} of your rows verified`, type: 'success' });
    },
    onError: (err) => {
      setToast({ message: err.message || 'Chain verify failed', type: 'error' });
    },
  });

  const queryParams = {
    limit: LIMIT,
    cursor,
    action: filterAction || undefined,
    actorId: filterActorId || undefined,
    targetType: filterTargetType || undefined,
    targetId: debouncedTargetId || undefined,
    wasExternal: filterWasExternal || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };

  const { data, isLoading } = trpc.partner.audit.getAuditLog.useQuery(queryParams);
  const utils = trpc.useUtils();
  const items = useMemo(() => data?.items || [], [data?.items]);

  // Open-from-URL: hydrate drawer state when the row matching ?p.open=<id>
  // lands on the current page. Inherently cross-render — URL param arrives
  // before query resolves.
  useEffect(() => {
    if (!openId || selectedEntry) return;
    const match = items.find(l => l.id === openId);
    if (match) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedEntry({
        id: match.id,
        action: match.action,
        actorId: match.actorId,
        actorName: match.actorName,
        partnerId: match.partnerId,
        targetType: match.targetType,
        targetId: match.targetId,
        metadata: match.metadata,
        createdAt: match.createdAt,
      });
    }
  }, [items, openId, selectedEntry]);
  const page = cursorStack.length;

  const actors = items.length
    ? Array.from(new Map(items.filter(l => l.actorId && l.actorName).map(l => [l.actorId, l.actorName])).entries())
    : [];

  async function handleExport(format: 'csv' | 'json') {
    try {
      const rows = await utils.partner.audit.exportAuditLog.fetch({
        action: filterAction || undefined,
        actorId: filterActorId || undefined,
        targetType: filterTargetType || undefined,
        targetId: debouncedTargetId || undefined,
        wasExternal: filterWasExternal || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });

      if (!rows || rows.length === 0) {
        setToast({ message: 'Nothing to export', type: 'error' });
        return;
      }

      const stamp = new Date().toISOString().slice(0, 10);
      let blob: Blob;
      let filename: string;
      if (format === 'json') {
        blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json;charset=utf-8;' });
        filename = `guichet_audit_${stamp}.json`;
      } else {
        const headers = ['Time', 'Action', 'Actor', 'Target type', 'Target id', 'Metadata'];
        const csv = [
          headers.join(','),
          ...rows.map(l => [
            new Date(l.createdAt).toISOString(),
            l.action,
            l.actorName || 'System',
            l.targetType || '',
            l.targetId || '',
            JSON.stringify(l.metadata).replace(/"/g, '""'),
          ].map(c => `"${c}"`).join(',')),
        ].join('\n');
        blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        filename = `guichet_audit_${stamp}.csv`;
      }

      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error(err);
      setToast({ message: 'Export failed', type: 'error' });
    }
  }

  return (
    <div className="max-w-6xl space-y-6 pb-24">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">Audit log</h2>
          <p className="text-[13px] text-[var(--color-ink-soft)] mt-1">
            Security-relevant actions in this tenant. Export for compliance review.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={() => verifyChain.mutate()}
            disabled={verifyChain.isPending}
            data-testid="verify-chain-btn"
          >
            {verifyChain.isPending ? 'Verifying…' : 'Verify chain'}
          </Button>
          <Button variant="primary" size="md" onClick={() => handleExport('csv')}>Export CSV</Button>
          <Button variant="secondary" size="md" onClick={() => handleExport('json')}>Export JSON</Button>
        </div>
      </div>

      <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-soft)] p-4 flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="space-y-1">
            <SectionLabel>Action</SectionLabel>
            <select
              value={filterAction}
              onChange={e => setFilterAction(e.target.value)}
              className={inputClass}
            >
              <option value="">All actions</option>
              {(actionList || []).map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <SectionLabel>Actor</SectionLabel>
            <select
              value={filterActorId}
              onChange={e => setFilterActorId(e.target.value)}
              className={inputClass}
            >
              <option value="">All actors</option>
              {actors.map(([id, name]) => (
                <option key={id!} value={id!}>{name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <SectionLabel>Target type</SectionLabel>
            <select
              id="target-type-filter"
              value={filterTargetType}
              onChange={e => setFilterTargetType(e.target.value)}
              className={inputClass}
            >
              <option value="">All targets</option>
              {(targetTypeList || []).map(tt => (
                <option key={tt} value={tt}>{tt}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <SectionLabel>Target id</SectionLabel>
            <input
              id="target-id-filter"
              type="text"
              placeholder="Search target id"
              value={filterTargetId}
              onChange={e => setFilterTargetId(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="space-y-1">
            <SectionLabel>From</SectionLabel>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="space-y-1">
            <SectionLabel>To</SectionLabel>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              onChange={e => setDateTo(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-3 border-t border-[var(--color-border)]">
          <input
            id="was-external-filter"
            type="checkbox"
            checked={filterWasExternal}
            onChange={e => setFilterWasExternal(e.target.checked)}
            className="rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
          />
          <label htmlFor="was-external-filter" className="text-[12px] text-[var(--color-ink-soft)] cursor-pointer">
            Guest (external) actions only
          </label>
        </div>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-[13px] text-[var(--color-ink-muted)]">Loading…</div>
      ) : (
        <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)] overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[720px]">
            <thead>
              <tr className="bg-[var(--color-bg-elevated)] border-b border-[var(--color-border)]">
                <th className="p-3 text-[11px] font-semibold text-[var(--color-ink-muted)]">Time</th>
                <th className="p-3 text-[11px] font-semibold text-[var(--color-ink-muted)]">Action</th>
                <th className="p-3 text-[11px] font-semibold text-[var(--color-ink-muted)]">Actor</th>
                <th className="p-3 text-[11px] font-semibold text-[var(--color-ink-muted)]">Target</th>
                <th className="p-3 text-[11px] font-semibold text-[var(--color-ink-muted)]">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-16 text-center">
                    <p className="text-[13px] text-[var(--color-ink-muted)]">No entries</p>
                  </td>
                </tr>
              )}
              {items.map(log => (
                <tr
                  key={log.id}
                  onClick={() => {
                    setSelectedEntry({
                      id: log.id,
                      action: log.action,
                      actorId: log.actorId,
                      actorName: log.actorName,
                      partnerId: log.partnerId,
                      targetType: log.targetType,
                      targetId: log.targetId,
                      metadata: log.metadata,
                      createdAt: log.createdAt,
                    });
                    setOpenId(log.id);
                  }}
                  className={`hover:bg-[var(--color-hover)] cursor-pointer transition-colors ${severityRowClass(auditSeverity(log.action))}`}
                  data-audit-row-id={log.id}
                  data-audit-severity={auditSeverity(log.action)}
                >
                  <td className="p-3 text-[11px] font-mono text-[var(--color-ink-soft)] whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="p-3 text-[12px] font-semibold text-[var(--color-ink)]">{log.action}</td>
                  <td className="p-3 text-[12px] text-[var(--color-ink)]">{log.actorName || <span className="text-[var(--color-ink-muted)]">System</span>}</td>
                  <td className="p-3 text-[11px] font-mono text-[var(--color-ink-soft)]">{log.targetId || '-'}</td>
                  <td className="p-3 text-[12px] text-[var(--color-ink-soft)] max-w-xs">
                    <div>{formatDetails(log)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-[var(--color-bg-base)] border-t border-[var(--color-border)] p-4 z-20">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4 text-[11px] text-[var(--color-ink-muted)]">
            <div className="flex items-center gap-2">
              <span>Records per page</span>
              <span className="font-medium text-[var(--color-ink-soft)]">{LIMIT}</span>
            </div>
            <span className="text-[var(--color-border-strong)]">·</span>
            <span>Page {page + 1}</span>
          </div>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="md"
              disabled={cursorStack.length === 0}
              onClick={() => {
                const stack = [...cursorStack];
                const prev = stack.pop();
                setCursorStack(stack);
                setCursor(prev || undefined);
              }}
            >
              ← Newer
            </Button>
            <Button
              variant="secondary"
              size="md"
              disabled={!data?.nextCursor}
              onClick={() => {
                if (data?.nextCursor) {
                  setCursorStack(prev => [...prev, cursor ?? '']);
                  setCursor(data.nextCursor);
                }
              }}
            >
              Older →
            </Button>
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <AuditMetadataDrawer
        entry={selectedEntry}
        onClose={() => {
          setSelectedEntry(null);
          setOpenId('');
        }}
        onFilterBy={(field, value) => {
          if (field === 'actorId') setFilterActorId(value);
          else if (field === 'targetType') setFilterTargetType(value);
          else if (field === 'targetId') setFilterTargetId(value);
        }}
      />
    </div>
  );
}

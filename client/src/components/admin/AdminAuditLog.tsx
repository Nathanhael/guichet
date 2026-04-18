import { useState, useCallback, useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import Toast from '../Toast';
import AuditMetadataDrawer, { type AuditEntry } from './AuditMetadataDrawer';

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

export default function AdminAuditLog() {
  const LIMIT = 50;
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [filterAction, setFilterAction] = useState('');
  const [filterActorId, setFilterActorId] = useState('');
  const [filterTargetType, setFilterTargetType] = useState('');
  const [filterTargetId, setFilterTargetId] = useState('');
  const [debouncedTargetId, setDebouncedTargetId] = useState('');
  const [filterWasExternal, setFilterWasExternal] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);

  const resetCursor = useCallback(() => {
    setCursor(undefined);
    setCursorStack([]);
  }, []);

  useEffect(() => {
    resetCursor();
  }, [filterAction, filterActorId, filterTargetType, filterWasExternal, dateFrom, dateTo, resetCursor]);

  // Debounce the target ID search so every keystroke doesn't fire a query.
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedTargetId(filterTargetId);
      resetCursor();
    }, 500);
    return () => clearTimeout(handler);
  }, [filterTargetId, resetCursor]);

  const { data: actionList } = trpc.partner.audit.listActions.useQuery();
  const { data: targetTypeList } = trpc.partner.audit.listTargetTypes.useQuery();

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
  const items = data?.items || [];
  const page = cursorStack.length;

  const actors = items.length
    ? Array.from(new Map(items.filter(l => l.actorId && l.actorName).map(l => [l.actorId, l.actorName])).entries())
    : [];

  async function handleExport() {
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

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', `guichet_audit_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error(err);
      setToast({ message: 'Export failed', type: 'error' });
    }
  }

  return (
    <div className="max-w-6xl space-y-6 pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-2xl font-bold uppercase tracking-tight">Audit Log</h2>
          <p className="text-xs uppercase font-bold text-[var(--color-text-secondary)] mt-1 tracking-wide">
            Security-relevant actions in this tenant. Export for compliance review.
          </p>
        </div>
        <button onClick={handleExport} className="btn-primary">Export CSV</button>
      </div>

      <div className="flex flex-col gap-3 bg-bg-elevated p-4 border border-[var(--color-border)]">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="space-y-1">
            <label className="mono-label ml-1">Action</label>
            <select
              value={filterAction}
              onChange={e => setFilterAction(e.target.value)}
              className="input-field w-full"
            >
              <option value="">All actions</option>
              {(actionList || []).map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="mono-label ml-1">Actor</label>
            <select
              value={filterActorId}
              onChange={e => setFilterActorId(e.target.value)}
              className="input-field w-full"
            >
              <option value="">All actors</option>
              {actors.map(([id, name]) => (
                <option key={id!} value={id!}>{name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="mono-label ml-1">Target type</label>
            <select
              id="target-type-filter"
              value={filterTargetType}
              onChange={e => setFilterTargetType(e.target.value)}
              className="input-field w-full"
            >
              <option value="">All targets</option>
              {(targetTypeList || []).map(tt => (
                <option key={tt} value={tt}>{tt}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="mono-label ml-1">Target id</label>
            <input
              id="target-id-filter"
              type="text"
              placeholder="Search target id"
              value={filterTargetId}
              onChange={e => setFilterTargetId(e.target.value)}
              className="input-field w-full"
            />
          </div>

          <div className="space-y-1">
            <label className="mono-label ml-1">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="input-field w-full"
            />
          </div>

          <div className="space-y-1">
            <label className="mono-label ml-1">To</label>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              onChange={e => setDateTo(e.target.value)}
              className="input-field w-full"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-3 border-t border-[var(--color-border)]">
          <input
            id="was-external-filter"
            type="checkbox"
            checked={filterWasExternal}
            onChange={e => setFilterWasExternal(e.target.checked)}
          />
          <label htmlFor="was-external-filter" className="mono-label cursor-pointer">
            Guest (external) actions only
          </label>
        </div>
      </div>

      {isLoading ? (
        <div className="py-8 text-center uppercase font-bold text-[var(--color-text-muted)]">Loading</div>
      ) : (
        <div className="surface-card overflow-x-auto flex-1 mb-[72px]">
          <table className="w-full text-left border-collapse min-w-[720px]">
            <thead>
              <tr className="bg-bg-elevated border-b border-[var(--color-border)]">
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Time</th>
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Action</th>
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Actor</th>
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Target</th>
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-16 text-center">
                    <p className="text-sm font-bold uppercase tracking-wide text-[var(--color-text-muted)]">No entries</p>
                  </td>
                </tr>
              )}
              {items.map(log => (
                <tr
                  key={log.id}
                  onClick={() => setSelectedEntry({
                    id: log.id,
                    action: log.action,
                    actorId: log.actorId,
                    actorName: log.actorName,
                    partnerId: log.partnerId,
                    targetType: log.targetType,
                    targetId: log.targetId,
                    metadata: log.metadata,
                    createdAt: log.createdAt,
                  })}
                  className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] cursor-pointer"
                  data-audit-row-id={log.id}
                >
                  <td className="p-3 text-[10px] font-mono whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="p-3 text-xs font-bold uppercase">{log.action}</td>
                  <td className="p-3 text-xs uppercase">{log.actorName || <span className="text-[var(--color-text-muted)]">System</span>}</td>
                  <td className="p-3 text-xs font-mono text-[var(--color-text-secondary)]">{log.targetId || '-'}</td>
                  <td className="p-3 text-[10px] text-[var(--color-text-secondary)] max-w-xs">
                    <div className="font-bold uppercase tracking-wide">{formatDetails(log)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-[var(--color-bg-base)] border-t border-[var(--color-border)] p-4 z-20">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            <div className="flex items-center gap-2">
              <span>Records per page</span>
              <span className="border-b border-current pb-0.5">{LIMIT}</span>
            </div>
            <span>|</span>
            <span>Page {page + 1}</span>
          </div>

          <div className="flex gap-4">
            <button
              disabled={cursorStack.length === 0}
              onClick={() => {
                const stack = [...cursorStack];
                const prev = stack.pop();
                setCursorStack(stack);
                setCursor(prev || undefined);
              }}
              className="btn-secondary disabled:opacity-30"
            >
              &larr; Newer
            </button>
            <button
              disabled={!data?.nextCursor}
              onClick={() => {
                if (data?.nextCursor) {
                  setCursorStack(prev => [...prev, cursor ?? '']);
                  setCursor(data.nextCursor);
                }
              }}
              className="btn-secondary disabled:opacity-30"
            >
              Older &rarr;
            </button>
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <AuditMetadataDrawer entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';

const ACTION_OPTIONS = [
  'partner.created',
  'partner.config_updated',
  'partner.deactivated',
  'partner.reactivated',
  'partner.deleted',
  'platform.enter_partner',
  'member.added',
  'member.invited',
  'member.removed',
  'member.updated',
  'user.sessions_revoked',
  'user.deleted',
  'sso.group_mapping_added',
  'sso.group_mapping_updated',
  'sso.group_mapping_removed',
  'gdpr.purge',
] as const;

const SECURITY_ACTIONS = new Set<string>([
  'partner.created',
  'partner.deactivated',
  'partner.reactivated',
  'partner.deleted',
  'platform.enter_partner',
  'member.added',
  'member.invited',
  'member.removed',
  'member.updated',
  'user.sessions_revoked',
  'user.deleted',
  'sso.group_mapping_added',
  'sso.group_mapping_updated',
  'sso.group_mapping_removed',
]);

function formatAuditDetails(log: { action: string; metadata?: unknown; targetId: string | null; actorName: string | null }) {
  const metadata = (log.metadata && typeof log.metadata === 'object') ? log.metadata as Record<string, unknown> : {};

  switch (log.action) {
    case 'user.sessions_revoked':
      return `Revoked active sessions for ${log.targetId || 'user'}`;
    case 'platform.enter_partner':
      return `Platform entry into tenant ${log.targetId || '-'}`;
    case 'member.updated':
      return `Role ${String(metadata.oldRole || '?')} -> ${String(metadata.newRole || '?')}`;
    case 'member.removed':
      return `Removed membership ${String(metadata.membershipId || log.targetId || '-')}`;
    case 'member.invited':
      return `Invited ${String(metadata.email || log.targetId || '-')}`;
    case 'partner.created':
      return `Created tenant with ${String(metadata.authMethod || 'unknown')} auth`;
    case 'partner.deactivated':
      return 'Tenant deactivated';
    case 'partner.reactivated':
      return 'Tenant reactivated';
    case 'partner.deleted':
      return 'Tenant deleted';
    case 'sso.group_mapping_added':
      return `Mapped Azure group ${String(metadata.azureGroupId || '-')}`;
    case 'sso.group_mapping_updated':
      return `Updated group mapping ${log.targetId || '-'}`;
    case 'sso.group_mapping_removed':
      return `Removed Azure group ${String(metadata.azureGroupId || '-')}`;
    default:
      return JSON.stringify(metadata);
  }
}

export default function PlatformAuditLog() {
  const t = useT();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<string[]>([]); // stack of previous cursors for back-nav
  const [filterAction, setFilterAction] = useState('');
  const [filterPartnerId, setFilterPartnerId] = useState('');
  const [filterActorId, setFilterActorId] = useState('');
  const [filterTargetId, setFilterTargetId] = useState('');
  const [debouncedTargetId, setDebouncedTargetId] = useState('');
  const [securityOnly, setSecurityOnly] = useState(false);

  // Date filtering state
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const LIMIT = 50;

  const resetCursor = useCallback(() => {
    setCursor(undefined);
    setCursorStack([]);
  }, []);

  // Debounce the target ID search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedTargetId(filterTargetId);
      resetCursor();
    }, 500);
    return () => clearTimeout(handler);
  }, [filterTargetId, resetCursor]);

  // Reset cursor when dates change
  useEffect(() => {
    resetCursor();
  }, [dateFrom, dateTo, resetCursor]);

  const { data: partners } = trpc.platform.listPartners.useQuery();

  const queryParams = {
    limit: LIMIT,
    cursor,
    action: filterAction || undefined,
    partnerId: filterPartnerId || undefined,
    actorId: filterActorId || undefined,
    targetId: debouncedTargetId || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };

  const { data, isLoading } = trpc.platform.getAuditLog.useQuery(queryParams);
  const utils = trpc.useUtils();
  const items = data?.items || [];
  const visibleData = securityOnly ? items.filter((log) => SECURITY_ACTIONS.has(log.action)) : items;
  const page = cursorStack.length;

  async function handleExport() {
    try {
      const currentParams = {
        action: filterAction || undefined,
        partnerId: filterPartnerId || undefined,
        actorId: filterActorId || undefined,
        targetId: debouncedTargetId || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      };

      const fullLog = await utils.platform.exportAuditLog.fetch(currentParams);

      if (!fullLog || fullLog.length === 0) return alert(t('no_data_export'));

      const headers = [t('col_time'), t('col_action'), t('col_actor'), t('col_partner_id'), t('col_target_type'), t('col_target_id'), t('col_metadata')];
      const rows = fullLog.map(l => [
        new Date(l.createdAt).toISOString(),
        l.action,
        l.actorName || t('system'),
        l.partnerId || '',
        l.targetType || '',
        l.targetId || '',
        JSON.stringify(l.metadata).replace(/"/g, '""')
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map(r => r.map(cell => `"${cell}"`).join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', `tessera_audit_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error(err);
      alert(t('export_failed'));
    }
  }

  // Derive unique actors from loaded log entries
  const actors = items.length
    ? Array.from(new Map(items.filter(l => l.actorId && l.actorName).map(l => [l.actorId, l.actorName])).entries())
    : [];

  return (
    <div className="max-w-6xl space-y-6 pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-2xl font-bold uppercase tracking-tight">{t('audit_log_title')}</h2>
          <p className="text-xs uppercase font-bold text-[var(--color-text-secondary)] mt-1 tracking-wide">{t('audit_log_desc')}</p>
        </div>
        <button
          onClick={handleExport}
          className="btn-primary"
        >
          {t('export_csv')}
        </button>
      </div>

      <div className="flex flex-col gap-3 bg-black/5 dark:bg-white/5 p-4 border border-[var(--color-border)]">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setSecurityOnly(true); resetCursor(); }}
            className={`px-4 py-2 border font-bold uppercase text-[10px] tracking-wide ${securityOnly ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)] border-[var(--color-border)]' : 'border-[var(--color-border)] hover:bg-[var(--color-accent-blue)] hover:text-white'}`}
          >
            {t('security_events')}
          </button>
          <button
            onClick={() => { setSecurityOnly(false); resetCursor(); }}
            className={`px-4 py-2 border font-bold uppercase text-[10px] tracking-wide ${!securityOnly ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)] border-[var(--color-border)]' : 'border-[var(--color-border)] hover:bg-[var(--color-accent-blue)] hover:text-white'}`}
          >
            {t('all_events')}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <label className="mono-label ml-1">{t('action_type')}</label>
            <select
              value={filterAction}
              onChange={e => { setFilterAction(e.target.value); resetCursor(); }}
              className="input-field w-full"
            >
              <option value="">{t('all_actions')}</option>
              {ACTION_OPTIONS.map((action) => (
                <option key={action} value={action}>{action}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="mono-label ml-1">{t('partner_context')}</label>
            <select
              value={filterPartnerId}
              onChange={e => { setFilterPartnerId(e.target.value); resetCursor(); }}
              className="input-field w-full"
            >
              <option value="">{t('all_partners')}</option>
              {(partners || []).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="mono-label ml-1">{t('actor_who')}</label>
            <select
              value={filterActorId}
              onChange={e => { setFilterActorId(e.target.value); resetCursor(); }}
              className="input-field w-full"
            >
              <option value="">{t('all_actors')}</option>
              {actors.map(([id, name]) => (
                <option key={id!} value={id!}>{name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="mono-label ml-1">{t('target_id_subject')}</label>
            <input
              type="text"
              placeholder={t('search_target_id')}
              value={filterTargetId}
              onChange={e => setFilterTargetId(e.target.value)}
              className="input-field w-full"
            />
          </div>
        </div>

        {/* Date Filters Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-[var(--color-border)]">
          <div className="space-y-1">
            <label className="mono-label ml-1">From Date</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); resetCursor(); }}
                className="input-field w-full"
              />
              {dateFrom && (
                <button
                  onClick={() => { setDateFrom(''); resetCursor(); }}
                  className="btn-secondary"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <label className="mono-label ml-1">To Date</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={dateTo}
                min={dateFrom}
                onChange={e => { setDateTo(e.target.value); resetCursor(); }}
                className="input-field w-full"
              />
              {dateTo && (
                <button
                  onClick={() => { setDateTo(''); resetCursor(); }}
                  className="btn-secondary"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </div>


      {isLoading ? (
        <div className="py-8 text-center uppercase font-bold text-[var(--color-text-muted)]">{t('loading_log')}</div>
      ) : (
        <div className="surface-card overflow-x-auto flex-1 mb-[72px]">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-black/5 dark:bg-white/5 border-b border-[var(--color-border)]">
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{t('col_time')}</th>
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{t('col_action')}</th>
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{t('col_actor')}</th>
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{t('col_partner_id')}</th>
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{t('col_details')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {visibleData?.map((log) => (
                <tr key={log.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                  <td className="p-3 text-[10px] font-mono whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="p-3 text-xs font-bold uppercase">{log.action}</td>
                  <td className="p-3 text-xs uppercase">{log.actorName || <span className="text-[var(--color-text-muted)]">{t('system')}</span>}</td>
                  <td className="p-3 text-xs font-mono text-[var(--color-text-secondary)]">{log.partnerId || '-'}</td>
                  <td className="p-3 text-[10px] text-[var(--color-text-secondary)] max-w-xs" title={JSON.stringify(log.metadata)}>
                    <div className="font-bold uppercase tracking-wide">{formatAuditDetails(log)}</div>
                    <div className="font-mono text-[var(--color-text-muted)] truncate">{JSON.stringify(log.metadata)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Enterprise Sticky Footer Pagination */}
      <div className="fixed bottom-0 left-0 right-0 bg-[var(--color-bg-base)] border-t border-[var(--color-border)] p-4 z-20">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            <div className="flex items-center gap-2">
              <span>{t('records_per_page')}</span>
              <span className="border-b border-current pb-0.5">{LIMIT}</span>
            </div>
            <span>|</span>
            <span>{t('page_indicator')} {page + 1}</span>
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
              &larr; {t('newer')}
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
              {t('older')} &rarr;
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

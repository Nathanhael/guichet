import { useState, useCallback, useEffect, useMemo } from 'react';
import { ScrollText } from 'lucide-react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import Toast from '../Toast';
import AuditMetadataDrawer, { type AuditEntry } from './AuditMetadataDrawer';
import { useUrlParam } from '../../hooks/useUrlState';
import { auditSeverity, severityRowClass } from '../../utils/auditSeverity';
import { formatAuditDetails } from '../../utils/auditFormat';
import Button from '../ui/Button';
import SectionLabel from '../ui/SectionLabel';

const inputClass =
  'w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 text-[13px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus:border-[var(--color-accent)] transition-colors';

export default function AdminAuditLog() {
  const t = useT();
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
        setToast({ message: t('no_data_export'), type: 'error' });
        return;
      }

      const stamp = new Date().toISOString().slice(0, 10);
      let blob: Blob;
      let filename: string;
      if (format === 'json') {
        blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json;charset=utf-8;' });
        filename = `guichet_audit_${stamp}.json`;
      } else {
        const headers = [t('col_time'), t('col_action'), t('col_actor'), t('col_target_type'), t('col_target_id'), t('col_metadata')];
        const csv = [
          headers.join(','),
          ...rows.map(l => [
            new Date(l.createdAt).toISOString(),
            l.action,
            l.actorName || t('system'),
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
      setToast({ message: t('export_failed'), type: 'error' });
    }
  }

  return (
    <div className="max-w-6xl space-y-6 pb-24">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">{t('audit_log_title')}</h2>
          <p className="text-[13px] text-[var(--color-ink-soft)] mt-1">{t('audit_log_partner_desc')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" size="md" onClick={() => handleExport('csv')}>{t('export_csv')}</Button>
          <Button variant="secondary" size="md" onClick={() => handleExport('json')}>{t('export_json')}</Button>
        </div>
      </div>

      <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-soft)] p-4 flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="space-y-1">
            <SectionLabel>{t('action_type')}</SectionLabel>
            <select
              value={filterAction}
              onChange={e => setFilterAction(e.target.value)}
              className={inputClass}
            >
              <option value="">{t('all_actions')}</option>
              {(actionList || []).map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <SectionLabel>{t('actor_who')}</SectionLabel>
            <select
              value={filterActorId}
              onChange={e => setFilterActorId(e.target.value)}
              className={inputClass}
            >
              <option value="">{t('all_actors')}</option>
              {actors.map(([id, name]) => (
                <option key={id!} value={id!}>{name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <SectionLabel>{t('col_target_type')}</SectionLabel>
            <select
              id="target-type-filter"
              value={filterTargetType}
              onChange={e => setFilterTargetType(e.target.value)}
              className={inputClass}
            >
              <option value="">{t('all_target_types')}</option>
              {(targetTypeList || []).map(tt => (
                <option key={tt} value={tt}>{tt}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <SectionLabel>{t('col_target_id')}</SectionLabel>
            <input
              id="target-id-filter"
              type="text"
              placeholder={t('search_target_id')}
              value={filterTargetId}
              onChange={e => setFilterTargetId(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="space-y-1">
            <SectionLabel>{t('from_date')}</SectionLabel>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="space-y-1">
            <SectionLabel>{t('to_date')}</SectionLabel>
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
            {t('guest_actions_only')}
          </label>
        </div>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-[13px] text-[var(--color-ink-muted)]">{t('loading_log')}</div>
      ) : (
        <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)] overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[720px]">
            <thead>
              <tr className="bg-[var(--color-bg-elevated)] border-b border-[var(--color-border)]">
                <th className="p-3 text-[11px] font-semibold text-[var(--color-ink-muted)]">{t('col_time')}</th>
                <th className="p-3 text-[11px] font-semibold text-[var(--color-ink-muted)]">{t('col_action')}</th>
                <th className="p-3 text-[11px] font-semibold text-[var(--color-ink-muted)]">{t('col_actor')}</th>
                <th className="p-3 text-[11px] font-semibold text-[var(--color-ink-muted)]">{t('col_target')}</th>
                <th className="p-3 text-[11px] font-semibold text-[var(--color-ink-muted)]">{t('col_details')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {items.length === 0 && (() => {
                const hasFilters = !!(filterAction || filterActorId || filterTargetId || filterTargetType || filterWasExternal || dateFrom || dateTo);
                return (
                  <tr>
                    <td colSpan={5} className="py-20 text-center">
                      <ScrollText className="w-10 h-10 mx-auto text-[var(--color-ink-muted)] opacity-60 mb-3" aria-hidden />
                      <p className="text-[13px] font-medium text-[var(--color-ink)]">
                        {hasFilters ? t('no_audit_entries') : t('no_audit_entries_empty')}
                      </p>
                      <p className="text-[12px] text-[var(--color-ink-muted)] mt-1 max-w-md mx-auto">
                        {hasFilters ? t('no_audit_entries_hint') : t('no_audit_entries_empty_hint')}
                      </p>
                      {hasFilters && (
                        <Button
                          variant="secondary"
                          size="md"
                          className="mt-4"
                          onClick={() => {
                            setFilterAction(''); setFilterActorId(''); setFilterTargetId('');
                            setFilterTargetType(''); setFilterWasExternal(false);
                            setDateFrom(''); setDateTo('');
                          }}
                        >
                          {t('clear_filters')}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })()}
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
                  <td className="p-3 text-[12px] text-[var(--color-ink)]">{log.actorName || <span className="text-[var(--color-ink-muted)]">{t('system')}</span>}</td>
                  <td className="p-3 text-[11px] font-mono text-[var(--color-ink-soft)]">{log.targetId || '-'}</td>
                  <td className="p-3 text-[12px] text-[var(--color-ink-soft)] max-w-xs">
                    <div>{formatAuditDetails(log, t)}</div>
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
              <span>{t('records_per_page')}</span>
              <span className="font-medium text-[var(--color-ink-soft)]">{LIMIT}</span>
            </div>
            <span className="text-[var(--color-border-strong)]">·</span>
            <span>{t('page_indicator')} {page + 1}</span>
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
              ← {t('newer')}
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
              {t('older')} →
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

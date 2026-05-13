import { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Download, ScrollText, Search } from 'lucide-react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import Toast from '../Toast';
import AuditMetadataDrawer, { type AuditEntry } from './AuditMetadataDrawer';
import CrossPartnerActivityPanel from './CrossPartnerActivityPanel';
import { useUrlParam } from '../../hooks/useUrlState';
import { auditSeverity, severityRowClass } from '../../utils/auditSeverity';
import { formatAuditDetails } from '../../utils/auditFormat';

import { CARD, INPUT_FULL as INPUT, FIELD_LABEL, COL_HEAD } from './adminStyles';

// Panel-local: PRIMARY_BTN uses opacity-50; SECONDARY_BTN uses px-4 not px-3.
// Diverges from canonical — reconcile in a design follow-up.
const PRIMARY_BTN = 'h-9 px-4 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-accent)] hover:brightness-110 text-white text-[13px] font-medium shadow-[var(--shadow-soft)] disabled:opacity-50 transition-all';
const SECONDARY_BTN = 'h-9 px-4 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[var(--color-ink)] text-[13px] font-medium transition-colors disabled:opacity-40';

export default function PlatformAuditLog() {
  const t = useT();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<string[]>([]); // stack of previous cursors for back-nav
  // Filters are mirrored into ?p.* so platform operators can bookmark/share
  // a cross-tenant triage view. Namespace `p` keeps us clear of the partner
  // view (`a.` — see AdminAuditLog).
  const [filterAction, setFilterAction] = useUrlParam('action', '', 'p');
  const [filterPartnerId, setFilterPartnerId] = useUrlParam('partner', '', 'p');
  const [filterActorId, setFilterActorId] = useUrlParam('actor', '', 'p');
  const [filterTargetId, setFilterTargetId] = useUrlParam('tid', '', 'p');
  const [filterTargetType, setFilterTargetType] = useUrlParam('ttype', '', 'p');
  const [debouncedTargetId, setDebouncedTargetId] = useState(() => filterTargetId);
  // Date filtering state
  const [dateFrom, setDateFrom] = useUrlParam('from', '', 'p');
  const [dateTo, setDateTo] = useUrlParam('to', '', 'p');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
  // Mirror the open drawer's row id into ?p.open=<id> for shareable links
  // to a specific cross-tenant audit entry.
  const [openId, setOpenId] = useUrlParam('open', '', 'p');

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

  // Reset cursor when dates change so the next query starts from page 1.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    resetCursor();
  }, [dateFrom, dateTo, resetCursor]);

  const { data: partners } = trpc.platform.listPartners.useQuery();
  const { data: targetTypeList } = trpc.platform.listTargetTypes.useQuery();
  const { data: actionList } = trpc.platform.listActions.useQuery();

  const queryParams = {
    limit: LIMIT,
    cursor,
    action: filterAction || undefined,
    partnerId: filterPartnerId || undefined,
    actorId: filterActorId || undefined,
    targetId: debouncedTargetId || undefined,
    targetType: filterTargetType || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };

  const { data, isLoading } = trpc.platform.getAuditLog.useQuery(queryParams);
  const utils = trpc.useUtils();
  const items = useMemo(() => data?.items || [], [data?.items]);

  // Open-from-URL: promote the row matching ?p.open=<id> when it lands on
  // the current page. Does not auto-fetch pages beyond cursor position.
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
  const visibleData = items;
  const page = cursorStack.length;

  async function handleExport(format: 'csv' | 'json') {
    try {
      const currentParams = {
        action: filterAction || undefined,
        partnerId: filterPartnerId || undefined,
        actorId: filterActorId || undefined,
        targetId: debouncedTargetId || undefined,
        targetType: filterTargetType || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      };

      const fullLog = await utils.platform.exportAuditLog.fetch(currentParams);

      if (!fullLog || fullLog.length === 0) { setToast({ message: t('no_data_export'), type: 'error' }); return; }

      const stamp = new Date().toISOString().slice(0, 10);
      let blob: Blob;
      let filename: string;
      if (format === 'json') {
        // Raw array keeps the JSON structurally identical to the tRPC query
        // result — downstream compliance tools can diff by id without
        // reshuffling keys. Pretty-printed for grep-ability.
        blob = new Blob([JSON.stringify(fullLog, null, 2)], { type: 'application/json;charset=utf-8;' });
        filename = `guichet_audit_${stamp}.json`;
      } else {
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
        blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
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

  // Derive unique actors from loaded log entries
  const actors = items.length
    ? Array.from(new Map(items.filter(l => l.actorId && l.actorName).map(l => [l.actorId, l.actorName])).entries())
    : [];

  return (
    <div className="max-w-6xl space-y-6 pb-24">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[var(--color-ink)] tracking-tight">{t('audit_log_title')}</h2>
          <p className="text-[13px] text-[var(--color-ink-soft)] mt-1">{t('audit_log_desc')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleExport('csv')}
            className={PRIMARY_BTN}
          >
            <Download className="w-4 h-4" aria-hidden />
            {t('export_csv')}
          </button>
          <button
            onClick={() => handleExport('json')}
            className={SECONDARY_BTN}
          >
            <Download className="w-4 h-4" aria-hidden />
            Export JSON
          </button>
        </div>
      </div>

      {/* Cross-partner activity rollup — surfaces the top-N partners by
          audit volume within the selected date window. Clicking a row
          scopes the audit log below to that partner, turning a broad
          "who's noisy right now?" question into a one-click investigation. */}
      <CrossPartnerActivityPanel
        dateFrom={dateFrom || undefined}
        dateTo={dateTo || undefined}
        onSelectPartner={(partnerId) => {
          setFilterPartnerId(partnerId);
          resetCursor();
        }}
      />

      <div className={`${CARD} p-4 space-y-3`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className={FIELD_LABEL}>{t('action_type')}</label>
            <select
              value={filterAction}
              onChange={e => { setFilterAction(e.target.value); resetCursor(); }}
              className={INPUT}
            >
              <option value="">{t('all_actions')}</option>
              {(actionList || []).map((action) => (
                <option key={action} value={action}>{action}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={FIELD_LABEL}>{t('partner_context')}</label>
            <select
              value={filterPartnerId}
              onChange={e => { setFilterPartnerId(e.target.value); resetCursor(); }}
              className={INPUT}
            >
              <option value="">{t('all_partners')}</option>
              {(partners || []).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={FIELD_LABEL}>{t('actor_who')}</label>
            <select
              value={filterActorId}
              onChange={e => { setFilterActorId(e.target.value); resetCursor(); }}
              className={INPUT}
            >
              <option value="">{t('all_actors')}</option>
              {actors.map(([id, name]) => (
                <option key={id!} value={id!}>{name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={FIELD_LABEL}>{t('col_target_type')}</label>
            <select
              id="platform-target-type-filter"
              value={filterTargetType}
              onChange={e => { setFilterTargetType(e.target.value); resetCursor(); }}
              className={INPUT}
            >
              <option value="">All types</option>
              {(targetTypeList || []).map(tt => (
                <option key={tt} value={tt}>{tt}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={FIELD_LABEL}>{t('col_target_id')}</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-ink-muted)] pointer-events-none" aria-hidden />
              <input
                type="text"
                placeholder={t('search_target_id')}
                value={filterTargetId}
                onChange={e => setFilterTargetId(e.target.value)}
                className={`${INPUT} pl-8`}
              />
            </div>
          </div>
        </div>

        {/* Date Filters Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-[var(--color-border)]">
          <div>
            <label className={FIELD_LABEL}>From Date</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); resetCursor(); }}
                className={INPUT}
              />
              {dateFrom && (
                <button
                  onClick={() => { setDateFrom(''); resetCursor(); }}
                  className={SECONDARY_BTN}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div>
            <label className={FIELD_LABEL}>To Date</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={dateTo}
                min={dateFrom}
                onChange={e => { setDateTo(e.target.value); resetCursor(); }}
                className={INPUT}
              />
              {dateTo && (
                <button
                  onClick={() => { setDateTo(''); resetCursor(); }}
                  className={SECONDARY_BTN}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </div>


      {isLoading ? (
        <div className="py-12 text-center text-[13px] text-[var(--color-ink-muted)]">{t('loading_log')}</div>
      ) : (
        <div className={`${CARD} overflow-x-auto mb-[72px]`}>
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className={COL_HEAD}>{t('col_time')}</th>
                <th className={COL_HEAD}>{t('col_action')}</th>
                <th className={COL_HEAD}>{t('col_actor')}</th>
                <th className={COL_HEAD}>{t('col_partner_id')}</th>
                <th className={COL_HEAD}>{t('col_target_id')}</th>
                <th className={COL_HEAD}>{t('col_details')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {(!visibleData || visibleData.length === 0) && (() => {
                const hasFilters = !!(filterAction || filterPartnerId || filterActorId || filterTargetId || filterTargetType || dateFrom || dateTo);
                return (
                  <tr>
                    <td colSpan={6} className="py-20 text-center">
                      <ScrollText className="w-10 h-10 mx-auto text-[var(--color-ink-muted)] opacity-60 mb-3" aria-hidden />
                      <p className="text-[13px] font-medium text-[var(--color-ink)]">
                        {hasFilters ? t('no_audit_entries') : t('no_audit_entries_empty')}
                      </p>
                      <p className="text-[12px] text-[var(--color-ink-muted)] mt-1 max-w-md mx-auto">
                        {hasFilters ? t('no_audit_entries_hint') : t('no_audit_entries_empty_hint')}
                      </p>
                      {hasFilters && (
                        <button
                          onClick={() => {
                            setFilterAction(''); setFilterPartnerId(''); setFilterActorId('');
                            setFilterTargetId(''); setFilterTargetType('');
                            setDateFrom(''); setDateTo('');
                            resetCursor();
                          }}
                          className={`${SECONDARY_BTN} mt-4`}
                        >
                          {t('clear_filters')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })()}
              {visibleData?.map((log) => (
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
                  <td className="px-4 py-3 text-[12px] text-[var(--color-ink-soft)] tabular-nums whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-[12px]">
                    <span className="inline-flex items-center px-2 h-6 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] font-mono text-[11px] text-[var(--color-ink)]">
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-[var(--color-ink)]">
                    {log.actorName || <span className="text-[var(--color-ink-muted)] italic">{t('system')}</span>}
                  </td>
                  <td className="px-4 py-3 text-[11px] font-mono text-[var(--color-ink-muted)]">{log.partnerId || '-'}</td>
                  <td className="px-4 py-3 text-[11px] font-mono text-[var(--color-ink-muted)]">{log.targetId || '-'}</td>
                  <td className="px-4 py-3 text-[12px] text-[var(--color-ink-soft)] max-w-xs">
                    <div className="text-[var(--color-ink)]">{formatAuditDetails(log, t)}</div>
                    <div className="font-mono text-[11px] text-[var(--color-ink-muted)] truncate mt-0.5">{JSON.stringify(log.metadata)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Sticky Footer Pagination */}
      <div className="fixed bottom-0 left-0 right-0 bg-[var(--color-bg)]/95 backdrop-blur border-t border-[var(--color-border)] p-4 z-20">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3 text-[12px] text-[var(--color-ink-muted)]">
            <span>
              {t('records_per_page')} <span className="text-[var(--color-ink)] tabular-nums">{LIMIT}</span>
            </span>
            <span className="text-[var(--color-border)]">|</span>
            <span>
              {t('page_indicator')} <span className="text-[var(--color-ink)] tabular-nums">{page + 1}</span>
            </span>
          </div>

          <div className="flex gap-2">
            <button
              disabled={cursorStack.length === 0}
              onClick={() => {
                const stack = [...cursorStack];
                const prev = stack.pop();
                setCursorStack(stack);
                setCursor(prev || undefined);
              }}
              className={SECONDARY_BTN}
            >
              <ChevronLeft className="w-4 h-4" aria-hidden />
              {t('newer')}
            </button>
            <button
              disabled={!data?.nextCursor}
              onClick={() => {
                if (data?.nextCursor) {
                  setCursorStack(prev => [...prev, cursor ?? '']);
                  setCursor(data.nextCursor);
                }
              }}
              className={SECONDARY_BTN}
            >
              {t('older')}
              <ChevronRight className="w-4 h-4" aria-hidden />
            </button>
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
          if (field === 'actorId') { setFilterActorId(value); resetCursor(); }
          else if (field === 'targetType') { setFilterTargetType(value); resetCursor(); }
          else if (field === 'targetId') setFilterTargetId(value);
        }}
      />
    </div>
  );
}

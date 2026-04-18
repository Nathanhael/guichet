import { useState, useEffect, useCallback } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import Toast from '../Toast';
import AuditMetadataDrawer, { type AuditEntry } from './AuditMetadataDrawer';
import CrossPartnerActivityPanel from './CrossPartnerActivityPanel';
import { useUrlParam } from '../../hooks/useUrlState';
import { auditSeverity, severityRowClass } from '../../utils/auditSeverity';

function formatAuditDetails(log: { action: string; metadata?: unknown; targetId: string | null; actorName: string | null }) {
  const metadata = (log.metadata && typeof log.metadata === 'object') ? log.metadata as Record<string, unknown> : {};

  switch (log.action) {
    // Partner
    case 'partner.created':
      return 'Created tenant';
    case 'partner.config_updated':
      return `Updated tenant configuration`;
    case 'partner.deactivated':
      return 'Tenant deactivated';
    case 'partner.reactivated':
      return 'Tenant reactivated';
    case 'partner.deleted':
      return 'Tenant deleted';
    // Platform
    case 'platform.enter_partner':
      return `Platform entry into tenant ${log.targetId || '-'}`;
    case 'platform_operator_bootstrap':
      return 'Platform operator auto-created on first startup';
    // Members
    case 'member.added':
      return `Added member ${String(metadata.email || log.targetId || '-')}`;
    case 'member.invited':
      return `Invited ${String(metadata.email || log.targetId || '-')}`;
    case 'member.removed':
      return `Removed membership ${String(metadata.membershipId || log.targetId || '-')}`;
    case 'member.updated':
      return `Role ${String(metadata.oldRole || '?')} -> ${String(metadata.newRole || '?')}`;
    // Users
    case 'user.deleted':
      return `User deleted ${log.targetId || ''}`;
    case 'user.login':
      return `Login from IP ${String(metadata.ip || metadata.IP || '-')}`;
    case 'user.profile_updated':
      return 'Profile updated';
    case 'user.sessions_revoked':
      return `Revoked active sessions for ${log.targetId || 'user'}`;
    // Security
    case 'security.account_locked':
      return `Account locked after failed login attempts`;
    case 'security.mfa_disabled':
      return 'MFA disabled by user';
    case 'security.mfa_disabled_by_admin':
      return 'MFA disabled by admin';
    case 'security.mfa_enabled':
      return 'MFA enabled';
    case 'security.mfa_recovery_codes_regenerated':
      return 'MFA recovery codes regenerated';
    case 'security.user_unlocked_by_admin':
      return 'Account unlocked by admin';
    // SSO
    case 'sso.email_conflict':
      return `SSO email conflict: ${String(metadata.email || '-')}`;
    case 'sso.group_mapping_added':
      return `Mapped Azure group ${String(metadata.azureGroupId || '-')}`;
    case 'sso.group_mapping_updated':
      return `Updated group mapping ${log.targetId || '-'}`;
    case 'sso.group_mapping_removed':
      return `Removed Azure group ${String(metadata.azureGroupId || '-')}`;
    case 'sso.membership_auto_created':
      return `Auto-created membership via SSO`;
    case 'sso.no_matching_groups':
      return 'SSO login: no matching group mappings';
    // System
    case 'system.archive_run':
      return `Archived ${String(metadata.count || '?')} records`;
    case 'system.gdpr_purge':
      return `Purged ${String(metadata.ticketsPurged || '?')} tickets, ${String(metadata.messagesPurged || '?')} messages`;
    // Content
    case 'kb.created':
      return `KB article: ${String(metadata.title || '-')}`;
    case 'label.created':
      return `Label: ${String(metadata.name || '-')}`;
    case 'webhook.created':
      return `Webhook: ${String(metadata.url || '-')}`;
    default:
      return JSON.stringify(metadata);
  }
}

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

  // Reset cursor when dates change
  useEffect(() => {
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
  const items = data?.items || [];

  // Open-from-URL: promote the row matching ?p.open=<id> when it lands on
  // the current page. Does not auto-fetch pages beyond cursor position.
  useEffect(() => {
    if (!openId || selectedEntry) return;
    const match = items.find(l => l.id === openId);
    if (match) {
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
    <div className="max-w-6xl space-y-6 pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-2xl font-bold uppercase tracking-tight">{t('audit_log_title')}</h2>
          <p className="text-xs uppercase font-bold text-[var(--color-text-secondary)] mt-1 tracking-wide">{t('audit_log_desc')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleExport('csv')}
            className="btn-primary"
          >
            {t('export_csv')}
          </button>
          <button
            onClick={() => handleExport('json')}
            className="btn-secondary"
          >
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

      <div className="flex flex-col gap-3 bg-bg-elevated p-4 border border-[var(--color-border)]">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="space-y-1">
            <label className="mono-label ml-1">{t('action_type')}</label>
            <select
              value={filterAction}
              onChange={e => { setFilterAction(e.target.value); resetCursor(); }}
              className="input-field w-full"
            >
              <option value="">{t('all_actions')}</option>
              {(actionList || []).map((action) => (
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
            <label className="mono-label ml-1">{t('col_target_type')}</label>
            <select
              id="platform-target-type-filter"
              value={filterTargetType}
              onChange={e => { setFilterTargetType(e.target.value); resetCursor(); }}
              className="input-field w-full"
            >
              <option value="">All types</option>
              {(targetTypeList || []).map(tt => (
                <option key={tt} value={tt}>{tt}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="mono-label ml-1">{t('col_target_id')}</label>
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
              <tr className="bg-bg-elevated border-b border-[var(--color-border)]">
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{t('col_time')}</th>
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{t('col_action')}</th>
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{t('col_actor')}</th>
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{t('col_partner_id')}</th>
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{t('col_target_id')}</th>
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{t('col_details')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {(!visibleData || visibleData.length === 0) && (
                <tr>
                  <td colSpan={6} className="py-16 text-center">
                    <p className="text-sm font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{t('no_audit_entries') || 'No audit entries'}</p>
                    <p className="text-[10px] uppercase text-[var(--color-text-muted)] mt-2 opacity-60">{t('no_audit_entries_hint') || 'Audit log entries will appear here as actions are performed.'}</p>
                  </td>
                </tr>
              )}
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
                  className={`hover:bg-black/[0.02] dark:hover:bg-white/[0.02] cursor-pointer ${severityRowClass(auditSeverity(log.action))}`}
                  data-audit-row-id={log.id}
                  data-audit-severity={auditSeverity(log.action)}
                >
                  <td className="p-3 text-[10px] font-mono whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="p-3 text-xs font-bold uppercase">{log.action}</td>
                  <td className="p-3 text-xs uppercase">{log.actorName || <span className="text-[var(--color-text-muted)]">{t('system')}</span>}</td>
                  <td className="p-3 text-xs font-mono text-[var(--color-text-secondary)]">{log.partnerId || '-'}</td>
                  <td className="p-3 text-xs font-mono text-[var(--color-text-secondary)]">{log.targetId || '-'}</td>
                  <td className="p-3 text-[10px] text-[var(--color-text-secondary)] max-w-xs">
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

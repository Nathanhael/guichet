import { useState, useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { Database, Server, ShieldCheck, Download } from 'lucide-react';
import { getSocket } from '../../hooks/useSocket';

function parseRetryAfter(message: string | undefined): number | null {
  if (!message) return null;
  const m = message.match(/retry in\s+(\d+)\s*s/i);
  return m ? parseInt(m[1], 10) : null;
}

const STALE_AFTER_DAYS = 7;
const STALE_AFTER_MS = STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;

type ChainVerifyRecord = {
  ranAt: string;
  ranBy?: string;
  ranByName?: string | null;
  valid: boolean;
  checked: number;
  brokenAt?: string;
  error?: string;
};

import { CARD } from './adminStyles';

// Panel-local: SECTION_H is unique; FIELD_LABEL drops mb and uses
// font-semibold (vs canonical font-medium); PRIMARY/SECONDARY_BTN use
// opacity-50 / px-4 / no disabled — diverges from canonical, reconcile
// in a design follow-up.
const SECTION_H = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] mb-3';
const FIELD_LABEL = 'text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]';
const PRIMARY_BTN = 'h-9 px-4 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-accent)] hover:brightness-110 text-white text-[13px] font-medium shadow-[var(--shadow-soft)] disabled:opacity-50 transition-all';
const SECONDARY_BTN = 'h-9 px-4 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[var(--color-ink)] text-[13px] font-medium transition-colors';

function csvField(v: string | number | boolean | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

function exportChainHistoryCsv(history: ChainVerifyRecord[]): void {
  const header = ['ran_at', 'status', 'checked', 'ran_by', 'ran_by_name', 'broken_at', 'error'];
  const rows = history.map((h) => [
    h.ranAt,
    h.error ? 'ERROR' : h.valid ? 'VALID' : 'BROKEN',
    h.checked,
    h.ranBy ?? '',
    h.ranByName ?? '',
    h.brokenAt ?? '',
    h.error ?? '',
  ]);
  const csv = [header, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-chain-verify-history-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-block w-2.5 h-2.5 rounded-full ${ok ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-urgent)]'}`} />
  );
}

type PillKind = 'valid' | 'broken' | 'error';

function StatusPill({ kind, t }: { kind: PillKind; t: (k: string) => string }) {
  const styles: Record<PillKind, string> = {
    valid: 'bg-[var(--color-ok-soft,rgba(34,197,94,0.12))] text-[var(--color-ok)]',
    broken: 'bg-[var(--color-urgent-soft,rgba(239,68,68,0.12))] text-[var(--color-urgent)]',
    error: 'bg-[var(--color-accent-amber-soft,rgba(245,158,11,0.14))] text-[var(--color-accent-amber)]',
  };
  const labelKey: Record<PillKind, string> = {
    valid: 'health_status_valid',
    broken: 'health_status_broken',
    error: 'health_status_error',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] text-[11px] font-semibold tracking-[0.04em] ${styles[kind]}`}
    >
      {t(labelKey[kind])}
    </span>
  );
}

function recordKind(r: { valid?: boolean; error?: string | null }): PillKind {
  if (r.error) return 'error';
  return r.valid ? 'valid' : 'broken';
}

/** Compact "5 min ago" / "2 h ago" / "3 d ago" — falls back to absolute date past 30 days. */
function relativeTime(iso: string, t: (k: string) => string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 45) return t('relative_just_now');
  if (sec < 90) return t('relative_one_min_ago');
  const min = Math.round(sec / 60);
  if (min < 60) return t('relative_min_ago').replace('{count}', String(min));
  const hr = Math.round(min / 60);
  if (hr < 24) return t('relative_hr_ago').replace('{count}', String(hr));
  const day = Math.round(hr / 24);
  if (day < 30) return t('relative_d_ago').replace('{count}', String(day));
  return new Date(iso).toLocaleDateString();
}

export default function PlatformSystemHealth() {
  const t = useT();
  const utils = trpc.useUtils();
  // Polling cadence: 5 min when visible, paused in background. Tab focus and
  // socket-pushed `audit:chain:broken` events trigger an immediate refetch so
  // the chain-tamper alert is effectively instant without per-minute spam.
  const { data: health, isLoading, isError, error, refetch } = trpc.platform.getSystemHealth.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const HISTORY_PREVIEW = 5;

  // Live push: server emits `audit:chain:broken` to platform operators when
  // chainVerifySchedule detects a tamper. Listening here just invalidates the
  // health query so the banner re-renders immediately instead of waiting for
  // the next 5-minute poll.
  useEffect(() => {
    const socket = getSocket();
    const onBroken = () => {
      utils.platform.getSystemHealth.invalidate();
      utils.platform.getLastChainVerify.invalidate();
      utils.platform.getChainVerifyHistory.invalidate();
    };
    socket.on('audit:chain:broken', onBroken);
    return () => {
      socket.off('audit:chain:broken', onBroken);
    };
  }, [utils]);

  const { data: lastVerify } = trpc.platform.getLastChainVerify.useQuery(undefined, {
    retry: false,
  }) as { data: ChainVerifyRecord | null | undefined };

  const { data: chainHistory } = trpc.platform.getChainVerifyHistory.useQuery(undefined, {
    retry: false,
  }) as { data: ChainVerifyRecord[] | undefined };

  const chainVerify = trpc.platform.verifyAuditChain.useMutation({
    onSuccess: () => {
      utils.platform.getLastChainVerify.invalidate();
      utils.platform.getChainVerifyHistory.invalidate();
    },
  });

  const [retryRemaining, setRetryRemaining] = useState<number>(0);
  // Rate-limit countdown: the server responds 429 + retry-after, we seed and
  // tick a local countdown. setState in the effect body seeds the initial value
  // once; the interval (a subscription) then pushes updates on each tick.
  useEffect(() => {
    if (chainVerify.error?.data?.code !== 'TOO_MANY_REQUESTS') return;
    const secs = parseRetryAfter(chainVerify.error.message);
    if (secs === null || secs <= 0) return;
    const deadline = Date.now() + secs * 1000;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRetryRemaining(secs);
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRetryRemaining(left);
      if (left === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [chainVerify.error]);

  const alerts: { id: string; message: string; severity: 'critical' | 'warning' }[] = [];
  if (health) {
    if (!health.redis) alerts.push({ id: 'redis-down', message: t('redis_unreachable'), severity: 'critical' });
    if (!health.postgres) alerts.push({ id: 'pg-down', message: t('postgres_unreachable'), severity: 'critical' });
    if (health.chainBroken) alerts.push({ id: 'chain-broken', message: t('health_audit_chain_broken_alert'), severity: 'critical' });
    if (!health.gdprSuccess) alerts.push({ id: 'gdpr-failed', message: t('gdpr_purge_failed'), severity: 'critical' });
    const lastRun = new Date(health.gdprLastRun).getTime();
    // eslint-disable-next-line react-hooks/purity
    if (Date.now() - lastRun > 25 * 60 * 60 * 1000) alerts.push({ id: 'gdpr-overdue', message: t('gdpr_purge_overdue'), severity: 'warning' });
    if (health.chainStale) alerts.push({ id: 'chain-stale', message: t('health_audit_chain_stale_alert'), severity: 'warning' });
    if (health.slaBreachBurst >= health.slaBreachBurstThreshold) {
      alerts.push({
        id: 'sla-burst',
        message: t('health_sla_burst_alert')
          .replace('{count}', String(health.slaBreachBurst))
          .replace('{threshold}', String(health.slaBreachBurstThreshold)),
        severity: 'warning',
      });
    }
  }
  const visibleAlerts = alerts.filter(a => !dismissedAlerts.includes(a.id));

  if (isLoading) {
    return <div className="p-8 text-[13px] text-[var(--color-ink-muted)] animate-pulse">{t('loading_system_health')}</div>;
  }

  if (isError || !health) {
    return (
      <div className={`${CARD} p-6 border-l-4 border-[var(--color-urgent)]`}>
        <p className="text-[14px] font-semibold text-[var(--color-urgent)] mb-2">{t('health_load_failed')}</p>
        {error && <p className="text-[12px] text-[var(--color-ink-muted)] mb-4">{t('health_error_prefix').replace('{message}', error.message)}</p>}
        <button onClick={() => refetch()} className={PRIMARY_BTN}>{t('health_retry_connection')}</button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-6">
      {visibleAlerts.length > 0 && (
        <div>
          <h2 className={SECTION_H}>{t('alerts')}</h2>
          <div className="space-y-2">
            {visibleAlerts.map(alert => (
              <div
                key={alert.id}
                className={`${CARD} p-4 flex justify-between items-center gap-4 border-l-4 ${
                  alert.severity === 'critical'
                    ? 'border-[var(--color-urgent)]'
                    : 'border-[var(--color-accent-amber)]'
                }`}
              >
                <span className="text-[13px] font-medium text-[var(--color-ink)]">{alert.message}</span>
                <button
                  onClick={() => setDismissedAlerts(d => [...d, alert.id])}
                  className={SECONDARY_BTN}
                >
                  {t('dismiss')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className={SECTION_H}>{t('services')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className={`${CARD} p-6`}>
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-[var(--color-ink-muted)]" />
                <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">PostgreSQL</h3>
              </div>
              <StatusDot ok={health.postgres} />
            </div>
            <div className="flex justify-between items-end">
              <span className={FIELD_LABEL}>{t('active_connections')}</span>
              <span className="text-[24px] font-medium text-[var(--color-ink)] tabular-nums">{health.postgresConnections}</span>
            </div>
          </div>

          <div className={`${CARD} p-6`}>
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-[var(--color-ink-muted)]" />
                <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">Redis</h3>
              </div>
              <StatusDot ok={health.redis} />
            </div>
            <div className="flex justify-between items-end">
              <span className={FIELD_LABEL}>{t('memory_used')}</span>
              <span className="text-[24px] font-medium text-[var(--color-ink)] tabular-nums">{health.redisMemoryUsed}</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className={SECTION_H}>{t('gdpr_purge_service')}</h2>
        <div className={`${CARD} p-6`}>
          <div className="flex items-center gap-4 mb-6 pb-6 border-b border-[var(--color-border)]">
            <StatusDot ok={health.gdprSuccess} />
            <div>
              <p className="text-[14px] font-semibold text-[var(--color-ink)]">{t('last_run')}</p>
              <p className="text-[12px] text-[var(--color-ink-muted)] mt-0.5 tabular-nums">{new Date(health.gdprLastRun).toLocaleString()}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-8">
            <div>
              <p className={FIELD_LABEL}>{t('retention_period')}</p>
              <p className="text-[18px] font-medium text-[var(--color-ink)] mt-1.5 tabular-nums">{t('health_30_days')}</p>
            </div>
            <div>
              <p className={FIELD_LABEL}>{t('records_purged')}</p>
              <p className="text-[18px] font-medium text-[var(--color-ink)] mt-1.5 tabular-nums">{health.gdprRecordsPurged}</p>
            </div>
            <div>
              <p className={FIELD_LABEL}>{t('next_purge')}</p>
              <p className="text-[13px] text-[var(--color-ink)] mt-1.5 tabular-nums">{new Date(health.gdprNextPurge).toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className={SECTION_H}>{t('health_section_audit_chain')}</h2>
        <div className={`${CARD} p-6`}>
          <div className="flex items-start justify-between gap-6 mb-6 pb-6 border-b border-[var(--color-border)]">
            <div className="flex-1 flex gap-3">
              <ShieldCheck className="h-5 w-5 text-[var(--color-ink-muted)] shrink-0 mt-0.5" />
              <div>
                <p className="text-[14px] font-semibold text-[var(--color-ink)] mb-1">{t('health_worm_verification_title')}</p>
                <p className="text-[12px] text-[var(--color-ink-muted)]">
                  {t('health_worm_verification_desc')}
                </p>
              </div>
            </div>
            <button
              onClick={() => chainVerify.mutate()}
              disabled={chainVerify.isPending || retryRemaining > 0}
              className={`${PRIMARY_BTN} whitespace-nowrap`}
              id="verify-audit-chain-btn"
              data-retry-remaining={retryRemaining}
            >
              {chainVerify.isPending
                ? t('health_verifying')
                : retryRemaining > 0
                  ? t('health_retry_in_seconds').replace('{seconds}', String(retryRemaining))
                  : t('health_verify_now')}
            </button>
          </div>

          {lastVerify && !chainVerify.isPending && (() => {
            // Date.now() in render gates a staleness banner; acceptable since the
            // banner only needs day-level precision and re-renders happen on mutations.
            // eslint-disable-next-line react-hooks/purity
            const ageMs = Date.now() - new Date(lastVerify.ranAt).getTime();
            if (ageMs < STALE_AFTER_MS) return null;
            const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
            return (
              <p
                className="text-[12px] font-medium text-[var(--color-accent-amber)] mb-4"
                data-testid="chain-verify-staleness-banner"
              >
                {t(days === 1 ? 'health_last_verification_stale_singular' : 'health_last_verification_stale_plural').replace('{days}', String(days))}
              </p>
            );
          })()}

          {chainVerify.error && (
            <p className="text-[12px] font-medium text-[var(--color-urgent)] mb-4">
              {chainVerify.error.data?.code === 'TOO_MANY_REQUESTS'
                ? retryRemaining > 0
                  ? t('health_rate_limited').replace('{seconds}', String(retryRemaining))
                  : chainVerify.error.message
                : t('health_verification_failed')}
            </p>
          )}

          {chainVerify.isPending && !lastVerify && (
            <p className="text-[12px] text-[var(--color-ink-muted)] animate-pulse">{t('health_scanning_archive')}</p>
          )}

          {lastVerify && (() => {
            const kind = recordKind(lastVerify);
            const headlineColor =
              kind === 'valid'
                ? 'text-[var(--color-ok)]'
                : kind === 'broken'
                  ? 'text-[var(--color-urgent)]'
                  : 'text-[var(--color-accent-amber)]';
            const headlineMark = kind === 'valid' ? '✓' : kind === 'broken' ? '✕' : '!';
            const totalRuns = chainHistory?.length ?? 1;
            return (
              <div className="space-y-5">
                <p
                  className={`text-[13px] font-medium flex items-center gap-2 ${headlineColor}`}
                  data-testid="chain-headline-summary"
                >
                  <span aria-hidden="true">{headlineMark}</span>
                  {kind === 'valid' && (
                    <>
                      {t(totalRuns === 1 ? 'health_chain_healthy_singular' : 'health_chain_healthy_plural')
                        .replace('{count}', String(totalRuns))
                        .replace('{when}', relativeTime(lastVerify.ranAt, t))}
                    </>
                  )}
                  {kind === 'broken' && <>{t('health_chain_broken_headline')}</>}
                  {kind === 'error' && <>{t('health_chain_error_headline')}</>}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  <div>
                    <p className={FIELD_LABEL}>{t('health_status')}</p>
                    <div className="mt-1.5">
                      <StatusPill kind={kind} t={t} />
                    </div>
                  </div>
                  <div>
                    <p className={FIELD_LABEL}>{t('health_entries_checked')}</p>
                    <p className="text-[18px] font-medium text-[var(--color-ink)] mt-1.5 tabular-nums">{lastVerify.checked.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className={FIELD_LABEL}>{t('health_last_verified')}</p>
                    <p className="text-[14px] font-medium text-[var(--color-ink)] mt-1.5">{relativeTime(lastVerify.ranAt, t)}</p>
                    <p className="text-[11px] text-[var(--color-ink-muted)] mt-0.5 tabular-nums">{new Date(lastVerify.ranAt).toLocaleString()}</p>
                    {lastVerify.ranBy === 'system-scheduler' ? (
                      <p className="text-[11px] text-[var(--color-ink-muted)] mt-1 flex items-center gap-1.5">
                        <span className="inline-block px-1.5 py-0.5 rounded-[var(--radius-pill)] text-[10px] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                          {t('health_scheduled_badge')}
                        </span>
                        {lastVerify.ranByName || t('health_daily_scheduler')}
                      </p>
                    ) : lastVerify.ranByName ? (
                      <p className="text-[11px] text-[var(--color-ink-muted)] mt-1">{t('health_by_actor').replace('{name}', lastVerify.ranByName)}</p>
                    ) : lastVerify.ranBy ? (
                      <p className="text-[11px] text-[var(--color-ink-muted)] mt-1">{t('health_by_actor').replace('{name}', lastVerify.ranBy)}</p>
                    ) : null}
                  </div>
                  {lastVerify.brokenAt && (
                <div className="md:col-span-3 pt-4 border-t border-[var(--color-border)]">
                  <p className={`${FIELD_LABEL} text-[var(--color-urgent)]`}>{t('health_broken_at_archive')}</p>
                  <p className="font-mono text-[12px] break-all text-[var(--color-ink)] mt-1.5">{lastVerify.brokenAt}</p>
                </div>
              )}
              {lastVerify.error && (
                <div className="md:col-span-3 pt-4 border-t border-[var(--color-border)]">
                  <p className={`${FIELD_LABEL} text-[var(--color-accent-amber)]`}>{t('health_error_label')}</p>
                  <p className="font-mono text-[12px] break-all text-[var(--color-ink)] mt-1.5">{lastVerify.error}</p>
                </div>
              )}
                </div>
              </div>
            );
          })()}

          {!lastVerify && !chainVerify.isPending && (
            <p className="text-[12px] text-[var(--color-ink-muted)]">{t('health_no_verification_yet')}</p>
          )}

          {chainHistory && chainHistory.length > 1 && (() => {
            const visible = historyExpanded
              ? chainHistory
              : chainHistory.slice(0, HISTORY_PREVIEW);
            const hiddenCount = chainHistory.length - visible.length;
            return (
            <div className="mt-6 pt-6 border-t border-[var(--color-border)]">
              <div className="flex items-center justify-between mb-3">
                <p className={FIELD_LABEL}>{t('health_run_history')}</p>
                <div className="flex items-center gap-2">
                  {chainHistory.length > HISTORY_PREVIEW && (
                    <button
                      type="button"
                      onClick={() => setHistoryExpanded(v => !v)}
                      className={SECONDARY_BTN}
                      data-testid="chain-history-toggle"
                    >
                      {historyExpanded ? t('health_show_less') : t('health_show_all_count').replace('{count}', String(chainHistory.length))}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => exportChainHistoryCsv(chainHistory)}
                    data-testid="export-chain-history-csv"
                    className={SECONDARY_BTN}
                    title={t('health_export_csv_title')}
                  >
                    <Download className="h-3.5 w-3.5" /> {t('filter_export_csv')}
                  </button>
                </div>
              </div>
              <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] overflow-hidden">
                <table
                  className="w-full text-left border-collapse"
                  data-testid="chain-verify-history"
                >
                  <thead>
                    <tr className="border-b border-[var(--color-border)]">
                      <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">{t('health_col_when')}</th>
                      <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">{t('health_status')}</th>
                      <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">{t('health_col_checked')}</th>
                      <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">{t('health_col_by')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {visible.map((h, i) => (
                      <tr key={`${h.ranAt}-${i}`}>
                        <td className="p-3 text-[12px] text-[var(--color-ink)] whitespace-nowrap">
                          <div className="text-[12px]">{relativeTime(h.ranAt, t)}</div>
                          <div className="text-[10px] text-[var(--color-ink-muted)] tabular-nums mt-0.5">
                            {new Date(h.ranAt).toLocaleString()}
                          </div>
                        </td>
                        <td className="p-3"><StatusPill kind={recordKind(h)} t={t} /></td>
                        <td className="p-3 text-[12px] text-[var(--color-ink-soft)] tabular-nums">{h.checked.toLocaleString()}</td>
                        <td className="p-3 text-[12px] text-[var(--color-ink-soft)]">
                          {h.ranBy === 'system-scheduler' ? (
                            <span data-testid="history-scheduler-badge" className="flex items-center gap-1.5">
                              <span className="inline-block px-1.5 py-0.5 rounded-[var(--radius-pill)] text-[10px] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                                {t('health_scheduled_badge')}
                              </span>
                              {h.ranByName || t('health_daily_scheduler')}
                            </span>
                          ) : (
                            h.ranByName || h.ranBy || '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!historyExpanded && hiddenCount > 0 && (
                <p className="text-[11px] text-[var(--color-ink-muted)] mt-2 text-center">
                  {t(hiddenCount === 1 ? 'health_earlier_runs_hidden_singular' : 'health_earlier_runs_hidden_plural').replace('{count}', String(hiddenCount))}
                </p>
              )}
            </div>
            );
          })()}
        </div>
      </div>

    </div>
  );
}

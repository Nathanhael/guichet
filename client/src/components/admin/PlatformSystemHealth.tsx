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

const CARD = 'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)]';
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
    if (health.chainBroken) alerts.push({ id: 'chain-broken', message: 'Audit chain integrity broken — investigate immediately.', severity: 'critical' });
    if (!health.gdprSuccess) alerts.push({ id: 'gdpr-failed', message: t('gdpr_purge_failed'), severity: 'critical' });
    const lastRun = new Date(health.gdprLastRun).getTime();
    // eslint-disable-next-line react-hooks/purity
    if (Date.now() - lastRun > 25 * 60 * 60 * 1000) alerts.push({ id: 'gdpr-overdue', message: t('gdpr_purge_overdue'), severity: 'warning' });
    if (health.chainStale) alerts.push({ id: 'chain-stale', message: 'Audit chain has not been verified in over 25 hours.', severity: 'warning' });
    if (health.slaBreachBurst >= health.slaBreachBurstThreshold) {
      alerts.push({
        id: 'sla-burst',
        message: `${health.slaBreachBurst} SLA breaches recorded in the last hour (threshold ${health.slaBreachBurstThreshold}).`,
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
        <p className="text-[14px] font-semibold text-[var(--color-urgent)] mb-2">Failed to load system health data.</p>
        {error && <p className="text-[12px] text-[var(--color-ink-muted)] mb-4">Error: {error.message}</p>}
        <button onClick={() => refetch()} className={PRIMARY_BTN}>Retry Connection</button>
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
              <p className="text-[18px] font-medium text-[var(--color-ink)] mt-1.5 tabular-nums">30 Days</p>
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
        <h2 className={SECTION_H}>Audit Chain Integrity</h2>
        <div className={`${CARD} p-6`}>
          <div className="flex items-start justify-between gap-6 mb-6 pb-6 border-b border-[var(--color-border)]">
            <div className="flex-1 flex gap-3">
              <ShieldCheck className="h-5 w-5 text-[var(--color-ink-muted)] shrink-0 mt-0.5" />
              <div>
                <p className="text-[14px] font-semibold text-[var(--color-ink)] mb-1">WORM Archive Verification</p>
                <p className="text-[12px] text-[var(--color-ink-muted)]">
                  Scans every archived audit entry and recomputes its SHA-256 chain hash. Run after
                  any suspected tampering or before compliance review.
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
                ? 'Verifying…'
                : retryRemaining > 0
                  ? `Retry in ${retryRemaining}s`
                  : 'Verify Now'}
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
                Last verification was {days} day{days === 1 ? '' : 's'} ago — run a fresh scan.
              </p>
            );
          })()}

          {chainVerify.error && (
            <p className="text-[12px] font-medium text-[var(--color-urgent)] mb-4">
              {chainVerify.error.data?.code === 'TOO_MANY_REQUESTS'
                ? retryRemaining > 0
                  ? `Rate limited — retry in ${retryRemaining}s`
                  : chainVerify.error.message
                : 'Verification failed — check server logs.'}
            </p>
          )}

          {chainVerify.isPending && !lastVerify && (
            <p className="text-[12px] text-[var(--color-ink-muted)] animate-pulse">Scanning archive…</p>
          )}

          {lastVerify && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div>
                <p className={FIELD_LABEL}>Status</p>
                {lastVerify.error ? (
                  <p className="text-[18px] font-medium text-[var(--color-accent-amber)] mt-1.5">ERROR</p>
                ) : lastVerify.valid ? (
                  <p className="text-[18px] font-medium text-[var(--color-ok)] mt-1.5">VALID</p>
                ) : (
                  <p className="text-[18px] font-medium text-[var(--color-urgent)] mt-1.5">BROKEN</p>
                )}
              </div>
              <div>
                <p className={FIELD_LABEL}>Entries Checked</p>
                <p className="text-[18px] font-medium text-[var(--color-ink)] mt-1.5 tabular-nums">{lastVerify.checked.toLocaleString()}</p>
              </div>
              <div>
                <p className={FIELD_LABEL}>Last Verified</p>
                <p className="text-[13px] text-[var(--color-ink)] mt-1.5 tabular-nums">{new Date(lastVerify.ranAt).toLocaleString()}</p>
                {lastVerify.ranBy === 'system-scheduler' ? (
                  <p className="text-[11px] text-[var(--color-ink-muted)] mt-1 flex items-center gap-1.5">
                    <span className="inline-block px-1.5 py-0.5 rounded-[var(--radius-pill)] text-[10px] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                      Scheduled
                    </span>
                    {lastVerify.ranByName || 'Daily scheduler'}
                  </p>
                ) : lastVerify.ranByName ? (
                  <p className="text-[11px] text-[var(--color-ink-muted)] mt-1">By {lastVerify.ranByName}</p>
                ) : lastVerify.ranBy ? (
                  <p className="text-[11px] text-[var(--color-ink-muted)] mt-1">By {lastVerify.ranBy}</p>
                ) : null}
              </div>
              {lastVerify.brokenAt && (
                <div className="md:col-span-3 pt-4 border-t border-[var(--color-border)]">
                  <p className={`${FIELD_LABEL} text-[var(--color-urgent)]`}>Broken At (archive id)</p>
                  <p className="font-mono text-[12px] break-all text-[var(--color-ink)] mt-1.5">{lastVerify.brokenAt}</p>
                </div>
              )}
              {lastVerify.error && (
                <div className="md:col-span-3 pt-4 border-t border-[var(--color-border)]">
                  <p className={`${FIELD_LABEL} text-[var(--color-accent-amber)]`}>Error</p>
                  <p className="font-mono text-[12px] break-all text-[var(--color-ink)] mt-1.5">{lastVerify.error}</p>
                </div>
              )}
            </div>
          )}

          {!lastVerify && !chainVerify.isPending && (
            <p className="text-[12px] text-[var(--color-ink-muted)]">No verification has been run yet.</p>
          )}

          {chainHistory && chainHistory.length > 1 && (
            <div className="mt-6 pt-6 border-t border-[var(--color-border)]">
              <div className="flex items-center justify-between mb-3">
                <p className={FIELD_LABEL}>Run History</p>
                <button
                  type="button"
                  onClick={() => exportChainHistoryCsv(chainHistory)}
                  data-testid="export-chain-history-csv"
                  className={SECONDARY_BTN}
                  title="Download full chain verification history as CSV for compliance attestation"
                >
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </button>
              </div>
              <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] overflow-hidden">
                <table
                  className="w-full text-left border-collapse"
                  data-testid="chain-verify-history"
                >
                  <thead>
                    <tr className="border-b border-[var(--color-border)]">
                      <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">When</th>
                      <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">Status</th>
                      <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">Checked</th>
                      <th className="p-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {chainHistory.map((h, i) => (
                      <tr key={`${h.ranAt}-${i}`}>
                        <td className="p-3 text-[12px] text-[var(--color-ink-soft)] tabular-nums whitespace-nowrap">
                          {new Date(h.ranAt).toLocaleString()}
                        </td>
                        <td className="p-3 text-[12px] font-medium">
                          {h.error ? (
                            <span className="text-[var(--color-accent-amber)]">ERROR</span>
                          ) : h.valid ? (
                            <span className="text-[var(--color-ok)]">VALID</span>
                          ) : (
                            <span className="text-[var(--color-urgent)]">BROKEN</span>
                          )}
                        </td>
                        <td className="p-3 text-[12px] text-[var(--color-ink-soft)] tabular-nums">{h.checked.toLocaleString()}</td>
                        <td className="p-3 text-[12px] text-[var(--color-ink-soft)]">
                          {h.ranBy === 'system-scheduler' ? (
                            <span data-testid="history-scheduler-badge" className="flex items-center gap-1.5">
                              <span className="inline-block px-1.5 py-0.5 rounded-[var(--radius-pill)] text-[10px] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                                Scheduled
                              </span>
                              {h.ranByName || 'Daily scheduler'}
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
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

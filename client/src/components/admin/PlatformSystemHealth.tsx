import { useState, useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';

function parseRetryAfter(message: string | undefined): number | null {
  if (!message) return null;
  const m = message.match(/retry in\s+(\d+)\s*s/i);
  return m ? parseInt(m[1], 10) : null;
}

// 7 days — compliance baseline. If the last chain-verify is older than this
// the banner nudges operators to run a fresh scan. Higher than daily so a
// one-off skipped day doesn't nag, low enough that a full month of silence
// never goes unnoticed.
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

export default function PlatformSystemHealth() {
  const t = useT();
  const utils = trpc.useUtils();
  const { data: health, isLoading, isError, error, refetch } = trpc.platform.getSystemHealth.useQuery(undefined, {
    refetchInterval: 10000,
    retry: 1
  });
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);

  // Last-verified state is persisted in system_settings so every operator sees
  // the same status, not just the one who clicked the button.
  const { data: lastVerify } = trpc.platform.getLastChainVerify.useQuery(undefined, {
    retry: false,
  }) as { data: ChainVerifyRecord | null | undefined };

  // Rolling history of chain-verify runs. Rendered as a small compliance trail
  // below the latest-status card so reviewers don't need to page through
  // audit_log to reconstruct the sequence.
  const { data: chainHistory } = trpc.platform.getChainVerifyHistory.useQuery(undefined, {
    retry: false,
  }) as { data: ChainVerifyRecord[] | undefined };

  // Chain-integrity verification is a mutation — it mutates system_settings
  // (writing the run record) and a full scan walks the entire audit_archive,
  // so it must never run automatically on mount.
  const chainVerify = trpc.platform.verifyAuditChain.useMutation({
    onSuccess: () => {
      utils.platform.getLastChainVerify.invalidate();
      utils.platform.getChainVerifyHistory.invalidate();
    },
  });

  // Live countdown while the operator is rate-limited. Parsed out of the
  // server's error message ("Retry in Ns"), stored absolute so it remains
  // correct across re-renders, and ticked down once per second.
  const [retryRemaining, setRetryRemaining] = useState<number>(0);
  useEffect(() => {
    if (chainVerify.error?.data?.code !== 'TOO_MANY_REQUESTS') return;
    const secs = parseRetryAfter(chainVerify.error.message);
    if (secs === null || secs <= 0) return;
    const deadline = Date.now() + secs * 1000;
    setRetryRemaining(secs);
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRetryRemaining(left);
      if (left === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [chainVerify.error]);

  const alerts: { id: string; message: string }[] = [];
  if (health) {
    if (!health.redis) alerts.push({ id: 'redis-down', message: t('redis_unreachable') });
    if (!health.postgres) alerts.push({ id: 'pg-down', message: t('postgres_unreachable') });
    if (!health.gdprSuccess) alerts.push({ id: 'gdpr-failed', message: t('gdpr_purge_failed') });
    const lastRun = new Date(health.gdprLastRun).getTime();
    if (Date.now() - lastRun > 25 * 60 * 60 * 1000) alerts.push({ id: 'gdpr-overdue', message: t('gdpr_purge_overdue') });
  }
  const visibleAlerts = alerts.filter(a => !dismissedAlerts.includes(a.id));

  if (isLoading) return <div className="p-8 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] animate-pulse">{t('loading_system_health')}</div>;

  if (isError || !health) return (
    <div className="p-8 border border-[var(--color-accent-red)] bg-[var(--color-bg-elevated)]">
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[var(--color-accent-red)] mb-2">
        Failed to load system health data.
      </p>
      {error && (
        <p className="font-mono text-[9px] text-[var(--color-text-muted)] mb-4 uppercase">
          Error: {error.message}
        </p>
      )}
      <button onClick={() => refetch()} className="btn-primary text-[10px] uppercase tracking-widest px-4 py-2">
        Retry Connection
      </button>
    </div>
  );

  return (
    <div className="max-w-6xl space-y-8">
      {visibleAlerts.length > 0 && (
        <div>
          <h2 className="text-lg font-bold uppercase tracking-wide mb-4">{t('alerts')}</h2>
          <div className="space-y-2">
            {visibleAlerts.map(alert => (
              <div key={alert.id} className="surface-card p-4 flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-wide">{alert.message}</span>
                <button
                  onClick={() => setDismissedAlerts(d => [...d, alert.id])}
                  className="btn-secondary ml-4"
                >
                  {t('dismiss')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-bold uppercase tracking-wide mb-4">{t('services')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="surface-card p-6">
            <div className="flex justify-between items-start mb-4">
              <h3 className="font-bold uppercase tracking-wide">PostgreSQL</h3>
              <div className={`w-3 h-3 border border-[var(--color-border)] ${health.postgres ? 'bg-[var(--color-text-primary)]' : ''}`} />
            </div>
            <div className="flex justify-between items-end">
              <span className="mono-label">{t('active_connections')}</span>
              <span className="text-2xl font-mono">{health.postgresConnections}</span>
            </div>
          </div>

          <div className="surface-card p-6">
            <div className="flex justify-between items-start mb-4">
              <h3 className="font-bold uppercase tracking-wide">Redis</h3>
              <div className={`w-3 h-3 border border-[var(--color-border)] ${health.redis ? 'bg-[var(--color-text-primary)]' : ''}`} />
            </div>
            <div className="flex justify-between items-end">
              <span className="mono-label">{t('memory_used')}</span>
              <span className="text-2xl font-mono">{health.redisMemoryUsed}</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-bold uppercase tracking-wide mb-4">{t('gdpr_purge_service')}</h2>
        <div className="surface-card p-6">
          <div className="flex items-center gap-4 mb-6 pb-6 border-b border-[var(--color-border)]">
            <div className={`w-3 h-3 border border-[var(--color-border)] ${health.gdprSuccess ? 'bg-[var(--color-text-primary)]' : ''}`} />
            <div>
              <p className="font-bold uppercase tracking-wide">{t('last_run')}</p>
              <p className="text-xs text-[var(--color-text-secondary)] uppercase mt-1">{new Date(health.gdprLastRun).toLocaleString()}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-8">
            <div>
              <p className="mono-label mb-2">{t('retention_period')}</p>
              <p className="font-mono text-lg">30 Days</p>
            </div>
            <div>
              <p className="mono-label mb-2">{t('records_purged')}</p>
              <p className="font-mono text-lg">{health.gdprRecordsPurged}</p>
            </div>
            <div>
              <p className="mono-label mb-2">{t('next_purge')}</p>
              <p className="font-mono text-sm">{new Date(health.gdprNextPurge).toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-bold uppercase tracking-wide mb-4">Audit Chain Integrity</h2>
        <div className="surface-card p-6">
          <div className="flex items-start justify-between gap-6 mb-6 pb-6 border-b border-[var(--color-border)]">
            <div className="flex-1">
              <p className="font-bold uppercase tracking-wide mb-1">WORM Archive Verification</p>
              <p className="text-xs text-[var(--color-text-secondary)] uppercase">
                Scans every archived audit entry and recomputes its SHA-256 chain hash. Run after
                any suspected tampering or before compliance review.
              </p>
            </div>
            <button
              onClick={() => chainVerify.mutate()}
              disabled={chainVerify.isPending || retryRemaining > 0}
              className="btn-primary text-[10px] uppercase tracking-widest px-4 py-2 whitespace-nowrap"
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
            const ageMs = Date.now() - new Date(lastVerify.ranAt).getTime();
            if (ageMs < STALE_AFTER_MS) return null;
            const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
            return (
              <p
                className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-accent-amber)] mb-4"
                data-testid="chain-verify-staleness-banner"
              >
                Last verification was {days} day{days === 1 ? '' : 's'} ago — run a fresh scan.
              </p>
            );
          })()}

          {chainVerify.error && (
            <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-accent-red)] mb-4">
              {chainVerify.error.data?.code === 'TOO_MANY_REQUESTS'
                ? retryRemaining > 0
                  ? `Rate limited — retry in ${retryRemaining}s`
                  : chainVerify.error.message
                : 'Verification failed — check server logs.'}
            </p>
          )}

          {chainVerify.isPending && !lastVerify && (
            <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] animate-pulse">
              Scanning archive…
            </p>
          )}

          {lastVerify && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div>
                <p className="mono-label mb-2">Status</p>
                {lastVerify.error ? (
                  <p className="font-mono text-lg text-[var(--color-accent-amber)]">ERROR</p>
                ) : lastVerify.valid ? (
                  <p className="font-mono text-lg text-[var(--color-accent-green)]">VALID</p>
                ) : (
                  <p className="font-mono text-lg text-[var(--color-accent-red)]">BROKEN</p>
                )}
              </div>
              <div>
                <p className="mono-label mb-2">Entries Checked</p>
                <p className="font-mono text-lg">{lastVerify.checked.toLocaleString()}</p>
              </div>
              <div>
                <p className="mono-label mb-2">Last Verified</p>
                <p className="font-mono text-sm">{new Date(lastVerify.ranAt).toLocaleString()}</p>
                {lastVerify.ranByName && (
                  <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] mt-1">
                    By {lastVerify.ranByName}
                  </p>
                )}
                {!lastVerify.ranByName && lastVerify.ranBy && (
                  <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] mt-1">
                    By {lastVerify.ranBy}
                  </p>
                )}
              </div>
              {lastVerify.brokenAt && (
                <div className="md:col-span-3 pt-4 border-t border-[var(--color-border)]">
                  <p className="mono-label mb-2 text-[var(--color-accent-red)]">Broken At (archive id)</p>
                  <p className="font-mono text-xs break-all">{lastVerify.brokenAt}</p>
                </div>
              )}
              {lastVerify.error && (
                <div className="md:col-span-3 pt-4 border-t border-[var(--color-border)]">
                  <p className="mono-label mb-2 text-[var(--color-accent-amber)]">Error</p>
                  <p className="font-mono text-xs break-all">{lastVerify.error}</p>
                </div>
              )}
            </div>
          )}

          {!lastVerify && !chainVerify.isPending && (
            <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
              No verification has been run yet.
            </p>
          )}

          {chainHistory && chainHistory.length > 1 && (
            <div className="mt-6 pt-6 border-t border-[var(--color-border)]">
              <p className="mono-label mb-3">Run History</p>
              <div className="overflow-x-auto">
                <table
                  className="w-full text-left border-collapse"
                  data-testid="chain-verify-history"
                >
                  <thead>
                    <tr className="bg-bg-elevated border-b border-[var(--color-border)]">
                      <th className="p-2 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">When</th>
                      <th className="p-2 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Status</th>
                      <th className="p-2 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Checked</th>
                      <th className="p-2 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {chainHistory.map((h, i) => (
                      <tr key={`${h.ranAt}-${i}`}>
                        <td className="p-2 text-[10px] font-mono whitespace-nowrap">
                          {new Date(h.ranAt).toLocaleString()}
                        </td>
                        <td className="p-2 text-[10px] font-mono">
                          {h.error ? (
                            <span className="text-[var(--color-accent-amber)]">ERROR</span>
                          ) : h.valid ? (
                            <span className="text-[var(--color-accent-green)]">VALID</span>
                          ) : (
                            <span className="text-[var(--color-accent-red)]">BROKEN</span>
                          )}
                        </td>
                        <td className="p-2 text-[10px] font-mono">{h.checked.toLocaleString()}</td>
                        <td className="p-2 text-[10px] font-mono uppercase text-[var(--color-text-secondary)]">
                          {h.ranByName || h.ranBy || '—'}
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

      <div>
        <h2 className="text-lg font-bold uppercase tracking-wide mb-4">{t('observability')}</h2>
        <div className="flex gap-4">
          <a
            href={`http://${window.location.hostname}:3000`}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary"
          >
            Grafana Dashboards
          </a>
          <a
            href={`http://${window.location.hostname}:9090`}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary"
          >
            Prometheus Metrics
          </a>
        </div>
      </div>
    </div>
  );
}

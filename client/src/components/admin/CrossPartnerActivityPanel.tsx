import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';

/**
 * Cross-partner audit activity rollup.
 *
 * Aggregates audit_log rows per partner over the caller's selected time window
 * so platform operators can spot which tenant is unusually noisy — often the
 * first signal of a compromised account, a misconfigured SSO mapping, or an
 * internal tool gone wild. Purely an aggregate view; clicking a row scopes
 * the main audit log below by partnerId for the raw investigation.
 */
type Props = {
  dateFrom?: string;
  dateTo?: string;
  onSelectPartner: (partnerId: string) => void;
};

const COL_HEAD = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]';

export default function CrossPartnerActivityPanel({ dateFrom, dateTo, onSelectPartner }: Props) {
  const t = useT();
  const { data, isLoading } = trpc.platform.getCrossPartnerActivity.useQuery(
    { dateFrom, dateTo, limit: 10 },
    { refetchOnWindowFocus: false, staleTime: 30_000 },
  );

  if (isLoading) {
    return (
      <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)] p-5">
        <p className="text-[13px] text-[var(--color-ink-muted)]">{t('cross_partner_loading')}</p>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return null;
  }

  const total = data.reduce((sum, r) => sum + r.totalEvents, 0);

  return (
    <div
      className="rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)] p-5"
      data-testid="cross-partner-activity-panel"
    >
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <p className="text-[13px] font-semibold text-[var(--color-ink)]">{t('cross_partner_title').replace('{count}', String(data.length))}</p>
        <p className="text-[12px] text-[var(--color-ink-muted)] tabular-nums">
          {t('cross_partner_total_events').replace('{count}', total.toLocaleString())}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className={COL_HEAD}>{t('col_partner')}</th>
              <th className={`${COL_HEAD} text-right`}>{t('col_events')}</th>
              <th className={`${COL_HEAD} text-right`}>{t('col_pct_of_total')}</th>
              <th className={COL_HEAD}>{t('col_last_activity')}</th>
              <th className={COL_HEAD} />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {data.map((row) => {
              const partnerId = row.partnerId ?? '';
              if (!partnerId) return null;
              const pct = total > 0 ? ((row.totalEvents / total) * 100).toFixed(1) : '0.0';
              return (
                <tr key={partnerId} className="hover:bg-[var(--color-hover)]">
                  <td className="px-3 py-2.5 text-[13px] font-medium text-[var(--color-ink)]">
                    {row.partnerName || <span className="font-mono text-[12px] text-[var(--color-ink-muted)]">{partnerId}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-[13px] font-medium text-right tabular-nums text-[var(--color-ink)]">
                    {row.totalEvents.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-right tabular-nums text-[var(--color-ink-muted)]">
                    {pct}%
                  </td>
                  <td className="px-3 py-2.5 text-[12px] whitespace-nowrap text-[var(--color-ink-muted)]">
                    {row.lastEventAt ? new Date(row.lastEventAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => onSelectPartner(partnerId)}
                      data-testid={`cross-partner-activity-select-${partnerId}`}
                      className="text-[12px] font-medium px-2.5 h-7 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)] text-[var(--color-ink-soft)] transition-colors"
                    >
                      {t('cross_partner_filter_btn')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

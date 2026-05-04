import { useT } from '../../../i18n';

/**
 * Dashboard Z1 — Action list.
 *
 * Renders the four-bucket action list returned by `dashboard.getActionList`.
 * Controlled component: parent owns the tRPC query and passes results in.
 *
 * UX rules from spec §3 + §7:
 *   - All buckets empty -> single "All clear today" cell with a green tick.
 *   - Mixed populated -> render only categories that have items (no orphan
 *     headers). Each category title carries a count badge.
 *   - Each row is a real `<a>` so middle-click / cmd-click works and screen
 *     readers announce a link role.
 */

export type ActionItem =
  | {
      kind: 'sla_breach';
      id: string;
      ticketId: string;
      ticketTitle: string;
      breachedAt: string;
      linkTarget: string;
    }
  | {
      kind: 'abandoned';
      id: string;
      ticketId: string;
      ticketTitle: string;
      abandonedAt: string;
      linkTarget: string;
    }
  | {
      kind: 'feedback_untreated';
      id: string;
      feedbackType: string;
      preview: string;
      submittedAt: string;
      linkTarget: string;
    }
  | {
      kind: 'pending_invite';
      id: string;
      email: string;
      role: string;
      expiresAt: string;
      linkTarget: string;
    };

export interface ActionListData {
  slaBreaches: Extract<ActionItem, { kind: 'sla_breach' }>[];
  abandoned: Extract<ActionItem, { kind: 'abandoned' }>[];
  untreatedFeedback: Extract<ActionItem, { kind: 'feedback_untreated' }>[];
  pendingInvites: Extract<ActionItem, { kind: 'pending_invite' }>[];
}

export interface ActionListProps {
  data: ActionListData | null;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}

const ROW =
  'flex items-center justify-between gap-3 px-3 py-2 rounded-[var(--radius-btn)] hover:bg-[var(--color-hover)] transition-colors text-[13px] text-[var(--color-ink)] no-underline';
const CATEGORY_HEADER =
  'flex items-center gap-2 text-[12px] font-medium uppercase tracking-wide text-[var(--color-ink-muted)] px-1';
const COUNT_BADGE =
  'inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] text-[11px] text-[var(--color-ink-muted)]';

export function ActionList({ data, loading, error, onRetry }: ActionListProps) {
  const t = useT();
  if (loading) {
    return (
      <div data-testid="action-list-loading" className="flex flex-col gap-2" aria-busy="true">
        <div className="h-4 w-32 bg-[var(--color-bg-elevated)] rounded animate-pulse" />
        <div className="h-4 w-48 bg-[var(--color-bg-elevated)] rounded animate-pulse" />
        <div className="h-4 w-40 bg-[var(--color-bg-elevated)] rounded animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="action-list-error" className="flex items-center justify-between gap-3" role="alert">
        <span className="text-[13px] text-[var(--color-ink-muted)]">
          {t('error_action_list_load')}
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="h-8 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[12px] text-[var(--color-ink)]"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  if (!data) return null;

  const total =
    data.slaBreaches.length +
    data.abandoned.length +
    data.untreatedFeedback.length +
    data.pendingInvites.length;

  if (total === 0) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[var(--color-ink-muted)]">
        <span aria-hidden className="text-[var(--color-ok,green)]">✓</span>
        <span>{t('all_clear_today')}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {data.slaBreaches.length > 0 && (
        <Category
          title={t('action_sla_breaches')}
          countTestId="action-list-count-sla"
          count={data.slaBreaches.length}
        >
          {data.slaBreaches.map((item) => (
            <a key={item.id} href={item.linkTarget} className={ROW}>
              <span className="truncate">{item.ticketTitle}</span>
              <span className="text-[11px] text-[var(--color-ink-muted)]">
                #{item.ticketId}
              </span>
            </a>
          ))}
        </Category>
      )}

      {data.abandoned.length > 0 && (
        <Category
          title={t('action_abandoned')}
          countTestId="action-list-count-abandoned"
          count={data.abandoned.length}
        >
          {data.abandoned.map((item) => (
            <a key={item.id} href={item.linkTarget} className={ROW}>
              <span className="truncate">{item.ticketTitle}</span>
              <span className="text-[11px] text-[var(--color-ink-muted)]">
                #{item.ticketId}
              </span>
            </a>
          ))}
        </Category>
      )}

      {data.untreatedFeedback.length > 0 && (
        <Category
          title={t('action_untreated_feedback')}
          countTestId="action-list-count-feedback"
          count={data.untreatedFeedback.length}
        >
          {data.untreatedFeedback.map((item) => (
            <a key={item.id} href={item.linkTarget} className={ROW}>
              <span className="truncate">{item.preview}</span>
              <span className="text-[11px] text-[var(--color-ink-muted)] uppercase">
                {item.feedbackType}
              </span>
            </a>
          ))}
        </Category>
      )}

      {data.pendingInvites.length > 0 && (
        <Category
          title={t('action_pending_invites')}
          countTestId="action-list-count-invites"
          count={data.pendingInvites.length}
        >
          {data.pendingInvites.map((item) => (
            <a key={item.id} href={item.linkTarget} className={ROW}>
              <span className="truncate">{item.email}</span>
              <span className="text-[11px] text-[var(--color-ink-muted)]">
                {item.role}
              </span>
            </a>
          ))}
        </Category>
      )}
    </div>
  );
}

function Category({
  title,
  count,
  countTestId,
  children,
}: {
  title: string;
  count: number;
  countTestId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className={CATEGORY_HEADER}>
        <span>{title}</span>
        <span data-testid={countTestId} className={COUNT_BADGE}>
          {count}
        </span>
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

export default ActionList;

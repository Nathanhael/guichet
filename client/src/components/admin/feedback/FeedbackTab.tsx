import { useState } from 'react';
import { Check, ChevronDown, Inbox } from 'lucide-react';
import { Skeleton } from '../DashboardHelpers';
import Avatar from '../../ui/Avatar';
import { trpc } from '../../../utils/trpc';

export default function FeedbackTab() {
  const [showDismissed, setShowDismissed] = useState(false);

  const utils = trpc.useUtils();
  const feedbackQuery = trpc.feedback.list.useQuery();
  const markTreatedMutation = trpc.feedback.markTreated.useMutation({
    onSuccess: () => utils.feedback.list.invalidate(),
  });

  const feedback = feedbackQuery.data || [];
  const loading = feedbackQuery.isLoading;
  const activeFeedback = feedback.filter((f) => !f.treated);
  const dismissedFeedback = feedback.filter((f) => f.treated);

  const markTreated = (id: string) => markTreatedMutation.mutate(id);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : feedbackQuery.error ? (
          <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)] p-8 text-center">
            <p className="text-[13px] font-medium text-[var(--color-urgent)]">Failed to load feedback</p>
            <p className="text-[12px] text-[var(--color-ink-muted)] mt-2">{feedbackQuery.error.message}</p>
          </div>
        ) : activeFeedback.length === 0 ? (
          <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)] p-10 text-center">
            <Inbox className="h-10 w-10 mx-auto text-[var(--color-ink-muted)] opacity-60 mb-3" strokeWidth={1.5} />
            <p className="text-[13px] font-medium text-[var(--color-ink-soft)]">All caught up! No active feedback.</p>
          </div>
        ) : (
          activeFeedback.map((f) => (
            <div key={f.id} className="rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)] p-5">
              <div className="flex items-start justify-between mb-3 gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={f.userName || '?'} size={36} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-semibold text-[var(--color-ink)] truncate">{f.userName}</span>
                      <span className="text-[11px] font-medium uppercase tracking-[0.06em] bg-[var(--color-bg-elevated)] text-[var(--color-ink-muted)] px-2 py-0.5 rounded-[var(--radius-pill)]">
                        {f.role}
                      </span>
                    </div>
                    <span className="text-[12px] text-[var(--color-ink-muted)]">
                      {new Date(f.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => markTreated(f.id)}
                  disabled={markTreatedMutation.isPending}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 h-8 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[13px] font-medium text-[var(--color-ink)] disabled:opacity-50 transition-colors"
                  title="Mark as treated"
                >
                  <Check className="h-4 w-4" />
                  {markTreatedMutation.isPending ? 'Processing…' : 'Dismiss'}
                </button>
              </div>
              <p className="text-[14px] leading-relaxed text-[var(--color-ink)] whitespace-pre-wrap">{f.text}</p>
            </div>
          ))
        )}
      </div>

      {dismissedFeedback.length > 0 && (
        <div className="mt-8 border-t border-[var(--color-border)] pt-6">
          <button
            onClick={() => setShowDismissed(!showDismissed)}
            className="w-full flex items-center justify-between text-left px-4 py-3 rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)] hover:bg-[var(--color-hover)] transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-[14px] font-semibold text-[var(--color-ink)]">Dismissed Feedback</span>
              <span className="bg-[var(--color-bg-elevated)] text-[var(--color-ink-muted)] text-[11px] font-semibold px-2 py-0.5 rounded-[var(--radius-pill)]">
                {dismissedFeedback.length}
              </span>
            </div>
            <ChevronDown className={`h-4 w-4 text-[var(--color-ink-muted)] transition-transform ${showDismissed ? 'rotate-180' : ''}`} />
          </button>
          {showDismissed && (
            <div className="mt-3 space-y-3">
              {dismissedFeedback.map((f) => (
                <div key={f.id} className="rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] p-4 opacity-85">
                  <div className="flex items-start justify-between mb-2 gap-4 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold text-[var(--color-ink-soft)]">{f.userName}</span>
                      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">{f.role}</span>
                      <span className="text-[11px] bg-[var(--color-bg-surface)] text-[var(--color-ink-muted)] px-2 py-0.5 rounded-[var(--radius-pill)] flex items-center gap-1 font-medium">
                        <Check className="h-3 w-3" />
                        Treated
                      </span>
                    </div>
                    <span className="text-[12px] text-[var(--color-ink-muted)]">
                      {new Date(f.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  </div>
                  <p className="text-[13px] text-[var(--color-ink-soft)] whitespace-pre-wrap">{f.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

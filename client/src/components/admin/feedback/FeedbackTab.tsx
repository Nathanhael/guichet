import { useState } from 'react';
import { Skeleton } from '../DashboardHelpers';
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
          <div className="surface-card p-8 text-center">
            <p className="text-xs uppercase font-bold text-[var(--color-accent-red)]">Failed to load feedback</p>
            <p className="text-[10px] font-mono text-[var(--color-text-muted)] mt-2">{feedbackQuery.error.message}</p>
          </div>
        ) : activeFeedback.length === 0 ? (
          <div className="surface-card p-8 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto opacity-20 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-[var(--color-text-secondary)] text-sm font-medium">All caught up! No active feedback.</p>
          </div>
        ) : (
          activeFeedback.map((f) => (
            <div key={f.id} className="surface-card p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 border border-[var(--color-border)] flex items-center justify-center text-sm font-bold">
                    {(f.userName || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">{f.userName}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wide bg-bg-elevated text-[var(--color-text-secondary)] px-2 py-0.5">
                        {f.role}
                      </span>
                    </div>
                    <span className="text-xs text-[var(--color-text-secondary)]">
                      {new Date(f.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => markTreated(f.id)}
                  disabled={markTreatedMutation.isPending}
                  className="btn-secondary disabled:opacity-50"
                  title="Mark as treated"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  {markTreatedMutation.isPending ? 'Processing...' : 'Dismiss'}
                </button>
              </div>
              <p className="text-[15px] leading-relaxed pl-13">{f.text}</p>
            </div>
          ))
        )}
      </div>

      {dismissedFeedback.length > 0 && (
        <div className="mt-8 border-t border-[var(--color-border)] pt-6">
          <button
            onClick={() => setShowDismissed(!showDismissed)}
            className="w-full flex items-center justify-between text-left p-4 bg-bg-elevated hover:bg-bg-elevated border border-[var(--color-border)]"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold">Dismissed Feedback</span>
              <span className="bg-bg-elevated text-[var(--color-text-secondary)] text-xs font-semibold px-2.5 py-1">
                {dismissedFeedback.length}
              </span>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 text-[var(--color-text-secondary)] ${showDismissed ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {showDismissed && (
            <div className="mt-3 space-y-3">
              {dismissedFeedback.map((f) => (
                <div key={f.id} className="bg-bg-elevated border border-[var(--color-border)] p-4 opacity-75">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--color-text-secondary)]">{f.userName}</span>
                      <span className="text-[10px] uppercase font-bold text-[var(--color-text-muted)]">{f.role}</span>
                      <span className="text-xs bg-bg-elevated px-2 py-0.5 flex items-center gap-1 font-medium border border-[var(--color-border)]">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        Treated
                      </span>
                    </div>
                    <span className="text-xs text-[var(--color-text-secondary)]">
                      {new Date(f.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap">{f.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

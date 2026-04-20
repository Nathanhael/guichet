import { useState } from 'react';
import FeedbackTab from './feedback/FeedbackTab';
import RatingsTab from './feedback/RatingsTab';

type Tab = 'feedback' | 'ratings';

export default function AdminFeedback() {
  const [tab, setTab] = useState<Tab>('feedback');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h2 className="text-[18px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">Feedback &amp; Ratings</h2>
        <div className="inline-flex gap-1 p-1 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)]">
          {(['feedback', 'ratings'] as const).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-1 rounded-[var(--radius-pill)] text-[12px] font-medium transition-colors ${
                tab === id
                  ? 'bg-[var(--color-bg-surface)] text-[var(--color-ink)] shadow-[var(--shadow-soft)]'
                  : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              {id === 'feedback' ? 'Feedback' : 'Ratings'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'feedback' && <FeedbackTab />}
      {tab === 'ratings' && <RatingsTab />}
    </div>
  );
}

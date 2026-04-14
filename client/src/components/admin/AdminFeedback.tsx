import { useState } from 'react';
import FeedbackTab from './feedback/FeedbackTab';
import RatingsTab from './feedback/RatingsTab';

type Tab = 'feedback' | 'ratings';

export default function AdminFeedback() {
  const [tab, setTab] = useState<Tab>('feedback');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-bold">Feedback &amp; Ratings</h2>
        <div className="flex gap-1">
          <button
            onClick={() => setTab('feedback')}
            className={`px-3 py-1.5 text-xs font-medium ${
              tab === 'feedback'
                ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)]'
                : 'bg-bg-elevated text-[var(--color-text-secondary)] hover:opacity-100'
            }`}
          >
            Feedback
          </button>
          <button
            onClick={() => setTab('ratings')}
            className={`px-3 py-1.5 text-xs font-medium ${
              tab === 'ratings'
                ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)]'
                : 'bg-bg-elevated text-[var(--color-text-secondary)] hover:opacity-100'
            }`}
          >
            Ratings
          </button>
        </div>
      </div>

      {tab === 'feedback' && <FeedbackTab />}
      {tab === 'ratings' && <RatingsTab />}
    </div>
  );
}

import { useState } from 'react';
import useStore from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { useT } from '../i18n';

interface StarProps {
  filled: boolean;
  onClick: () => void;
}

function Star({ filled, onClick }: StarProps) {
  return (
    <button type="button" onClick={onClick}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className={`h-8 w-8 ${filled ? 'text-accent-blue' : 'text-text-muted'}`}
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    </button>
  );
}

export default function RatingModal() {
  const { user, ratingPrompt, clearRatingPrompt } = useStore();
  const t = useT();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (!ratingPrompt) return null;

  function submit() {
    if (rating === 0 || !user || !ratingPrompt) return;
    getSocket().emit('rating:submit', {
      ticketId: ratingPrompt.ticketId,
      rating,
      comment: comment.trim() || null,
    });
    setSubmitted(true);
    setTimeout(() => {
      clearRatingPrompt();
      setRating(0);
      setComment('');
      setSubmitted(false);
    }, 1500);
  }

  function skip() {
    clearRatingPrompt();
    setRating(0);
    setComment('');
  }

  return (
    <div className="fixed inset-0 bg-bg-base/80 flex items-center justify-center z-50">
      <div role="dialog" aria-modal="true" className="bg-bg-surface border border-border-heavy p-6 mx-4 max-w-sm w-full">
        {submitted ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 border border-border-heavy flex items-center justify-center mx-auto mb-3 text-xl font-bold">✓</div>
            <p className="text-sm font-medium text-text-primary">{t('rating_saved')}</p>
          </div>
        ) : (
          <>
            <h3 className="text-base font-bold uppercase text-text-primary mb-1">
              {t('rate_experience')}
            </h3>
            <p className="text-sm text-text-secondary mb-4">
              {t('rate_support_desc')} <span className="font-medium text-text-primary">{ratingPrompt.supportName}</span>
            </p>

            <div className="flex justify-center gap-1 mb-4">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} filled={n <= rating} onClick={() => setRating(n)} />
              ))}
            </div>

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('rating_comment_placeholder')}
              rows={2}
              className="input-field mb-4 resize-none"
            />

            <div className="flex gap-3">
              <button
                onClick={submit}
                disabled={rating === 0}
                className="flex-1 btn-primary py-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('submit_rating')}
              </button>
              <button
                onClick={skip}
                className="flex-1 btn-secondary py-2"
              >
                {t('skip')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

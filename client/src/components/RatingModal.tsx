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
    <button type="button" onClick={onClick} className="transition-transform hover:scale-110">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className={`h-8 w-8 transition-colors ${filled ? 'text-ui-orange' : 'text-ui-base1 dark:text-gray-600'}`}
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
      agentId: user.id,
      supportId: ratingPrompt.supportId,
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-ui-base3 dark:bg-brand-800 rounded-2xl shadow-xl p-6 mx-4 max-w-sm w-full border border-ui-base2 dark:border-brand-700">
        {submitted ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-2">&#10003;</div>
            <p className="text-sm font-medium text-ui-base01 dark:text-gray-200">{t('rating_saved')}</p>
          </div>
        ) : (
          <>
            <h3 className="text-base font-semibold text-ui-base01 dark:text-white mb-1">
              {t('rate_experience')}
            </h3>
            <p className="text-sm text-ui-base1 dark:text-gray-400 mb-4">
              {t('rate_support_desc')} <span className="font-medium text-ui-base01 dark:text-gray-200">{ratingPrompt.supportName}</span>
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
              className="w-full border border-ui-base2 dark:border-brand-600 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-brand-500 bg-ui-base3 dark:bg-gray-700 text-ui-base00 dark:text-gray-100 placeholder-ui-base1 resize-none"
            />

            <div className="flex gap-3">
              <button
                onClick={submit}
                disabled={rating === 0}
                className="flex-1 bg-brand-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {t('submit_rating')}
              </button>
              <button
                onClick={skip}
                className="flex-1 border border-ui-base2 dark:border-brand-600 text-ui-base01 dark:text-gray-300 py-2 rounded-lg text-sm font-medium hover:bg-ui-base2 dark:hover:bg-brand-700 transition-colors"
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

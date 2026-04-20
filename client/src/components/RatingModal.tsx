import { useState } from 'react';
import { CheckCircle2, Star } from 'lucide-react';
import { useStoreShallow } from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { useT } from '../i18n';
import Modal, { ModalBody, ModalFooter, ModalHeader } from './ui/Modal';
import Button from './ui/Button';

interface StarButtonProps {
  filled: boolean;
  onClick: () => void;
  label: string;
}

function StarButton({ filled, onClick, label }: StarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="p-1 transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] rounded-[var(--radius-btn)]"
    >
      <Star
        className={`h-8 w-8 ${filled ? 'text-[var(--color-accent-amber)] fill-[var(--color-accent-amber)]' : 'text-[var(--color-ink-muted)]'}`}
        strokeWidth={1.5}
      />
    </button>
  );
}

export default function RatingModal() {
  const { user, ratingPrompt, clearRatingPrompt } = useStoreShallow(s => ({
    user: s.user,
    ratingPrompt: s.ratingPrompt,
    clearRatingPrompt: s.clearRatingPrompt
  }));
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
    <Modal open={true} onClose={skip} id="rating-modal" maxWidth={440}>
      {submitted ? (
        <div className="px-6 py-10 text-center">
          <div className="w-12 h-12 rounded-full bg-[var(--color-ok-soft)] flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="h-6 w-6 text-[var(--color-ok)]" strokeWidth={2} />
          </div>
          <p className="text-[13px] font-medium text-[var(--color-ink)]">{t('rating_saved')}</p>
        </div>
      ) : (
        <>
          <ModalHeader
            title={t('rate_experience')}
            subtitle={
              <>
                {t('rate_support_desc')} <span className="font-medium text-[var(--color-ink)]">{ratingPrompt.supportName}</span>
              </>
            }
            onClose={skip}
          />
          <ModalBody>
            <div className="flex justify-center gap-1 my-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <StarButton
                  key={n}
                  filled={n <= rating}
                  onClick={() => setRating(n)}
                  label={`${n} star${n > 1 ? 's' : ''}`}
                />
              ))}
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('rating_comment_placeholder')}
              rows={2}
              className="mt-4 w-full resize-none rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-2 text-[13px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus:border-[var(--color-accent)]"
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" size="md" onClick={skip}>
              {t('skip')}
            </Button>
            <Button variant="primary" size="md" onClick={submit} disabled={rating === 0}>
              {t('submit_rating')}
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}

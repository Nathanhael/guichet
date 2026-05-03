import { useState } from 'react';
import { ThumbsUp, ThumbsDown, Sparkles } from 'lucide-react';
import { useT } from '../../i18n';
import { trpc } from '../../utils/trpc';
import Modal, { ModalHeader, ModalBody, ModalFooter } from '../ui/Modal';
import Button from '../ui/Button';

export interface ImproveDiffModalProps {
  pending: {
    original: string;
    improved: string;
    usageLogId: string | null;
  };
  onSendImproved: () => void;
  onSendOriginal: () => void;
  onDismiss: () => void;
}

/**
 * Forced-mode AI improve diff modal (slice 7). Shows the original and
 * improved messages side by side and lets the support staff explicitly
 * choose which to send. Optional thumbs row records explicit feedback on
 * the AI output. The "send original" path is implicit feedback — handled
 * by the parent hook calling `markImproveResult({ sentOriginal: true })`.
 *
 * Thumbs buttons are hidden when `usageLogId` is null because the server
 * couldn't write the usage-log row — without that row id there's no row
 * to annotate.
 */
export default function ImproveDiffModal({
  pending,
  onSendImproved,
  onSendOriginal,
  onDismiss,
}: ImproveDiffModalProps) {
  const t = useT();
  const submitFeedback = trpc.ai.submitFeedback.useMutation();
  const [feedbackChoice, setFeedbackChoice] = useState<'up' | 'down' | null>(null);
  const [feedbackToast, setFeedbackToast] = useState(false);

  const canSubmitFeedback = pending.usageLogId !== null;

  function handleThumbs(rating: 'up' | 'down') {
    if (!canSubmitFeedback || feedbackChoice !== null) return;
    setFeedbackChoice(rating);
    submitFeedback
      .mutateAsync({
        usageLogId: pending.usageLogId as string,
        rating,
        originalText: pending.original,
        aiOutput: pending.improved,
      })
      .then(() => setFeedbackToast(true))
      .catch(() => {
        // Allow retry — feedback failure is non-blocking, just clear the
        // pressed state so the user can try the other thumb.
        setFeedbackChoice(null);
      });
  }

  return (
    <Modal
      open={true}
      onClose={onDismiss}
      maxWidth={640}
      // User could lose work if they click the scrim by accident — disable
      // backdrop dismiss. Esc still works to close.
      dismissOnBackdrop={false}
      id="improve-diff-modal"
    >
      <ModalHeader
        title={
          <span className="flex items-center gap-2">
            <Sparkles size={16} className="text-[var(--color-accent)]" />
            {t('improve_modal_title') || 'AI improved your message'}
          </span>
        }
        onClose={onDismiss}
      />
      <ModalBody>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-1.5">
              {t('improve_modal_original_label') || 'Original'}
            </div>
            <div className="text-[13px] text-[var(--color-ink-soft)] whitespace-pre-wrap break-words">
              {pending.original}
            </div>
          </div>
          <div className="rounded-[var(--radius-card)] border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-accent)] mb-1.5">
              {t('improve_modal_improved_label') || 'Improved'}
            </div>
            <div className="text-[13px] text-[var(--color-ink)] whitespace-pre-wrap break-words">
              {pending.improved}
            </div>
          </div>
        </div>

        {canSubmitFeedback && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[11px] text-[var(--color-ink-muted)]">
              {feedbackToast
                ? t('improve_feedback_thanks_toast') || 'Thanks for the feedback'
                : ''}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                aria-label={t('improve_thumbs_up_aria') || 'Rate AI output thumbs up'}
                aria-pressed={feedbackChoice === 'up'}
                disabled={feedbackChoice !== null}
                onClick={() => handleThumbs('up')}
                className={`w-8 h-8 flex items-center justify-center rounded-[var(--radius-btn)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
                  feedbackChoice === 'up'
                    ? 'bg-[var(--color-accent)] text-[var(--color-btn-text-inverse)]'
                    : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <ThumbsUp size={14} strokeWidth={2} />
              </button>
              <button
                type="button"
                aria-label={t('improve_thumbs_down_aria') || 'Rate AI output thumbs down'}
                aria-pressed={feedbackChoice === 'down'}
                disabled={feedbackChoice !== null}
                onClick={() => handleThumbs('down')}
                className={`w-8 h-8 flex items-center justify-center rounded-[var(--radius-btn)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
                  feedbackChoice === 'down'
                    ? 'bg-[var(--color-urgent)] text-[var(--color-btn-text-inverse)]'
                    : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <ThumbsDown size={14} strokeWidth={2} />
              </button>
            </div>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onSendOriginal}>
          {t('improve_send_original') || 'Send original'}
        </Button>
        <Button variant="primary" onClick={onSendImproved}>
          {t('improve_send_improved') || 'Send improved'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

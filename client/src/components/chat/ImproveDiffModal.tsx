import { useCallback, useEffect, useState } from 'react';
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

  const handleThumbs = useCallback((rating: 'up' | 'down') => {
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
  }, [canSubmitFeedback, feedbackChoice, submitFeedback, pending.usageLogId, pending.original, pending.improved]);

  // Keyboard control for the modal:
  //   Enter             → Send improved (primary action)
  //   Shift+Enter       → Send original
  //   ArrowUp           → Thumbs up   (only when feedback is available)
  //   ArrowDown         → Thumbs down (only when feedback is available)
  //   Esc               → Modal primitive's own dismiss handler closes the
  //                       overlay (no send) — we do not bind it here.
  // The handler skips when focus is inside an INPUT/TEXTAREA/contenteditable
  // so future inner fields cannot get hijacked.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      const editable = (e.target as HTMLElement | null)?.isContentEditable;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) onSendOriginal();
        else onSendImproved();
        return;
      }
      if (e.key === 'ArrowUp' && canSubmitFeedback && feedbackChoice === null) {
        e.preventDefault();
        handleThumbs('up');
        return;
      }
      if (e.key === 'ArrowDown' && canSubmitFeedback && feedbackChoice === null) {
        e.preventDefault();
        handleThumbs('down');
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSendImproved, onSendOriginal, canSubmitFeedback, feedbackChoice, handleThumbs]);

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
              <span className="text-[10px] font-mono text-[var(--color-ink-muted)] opacity-60 mr-1 select-none" aria-hidden="true">
                ↑ / ↓
              </span>
              <button
                type="button"
                aria-label={t('improve_thumbs_up_aria') || 'Rate AI output thumbs up'}
                aria-keyshortcuts="ArrowUp"
                title={`${t('improve_thumbs_up_aria') || 'Thumbs up'} (↑)`}
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
                aria-keyshortcuts="ArrowDown"
                title={`${t('improve_thumbs_down_aria') || 'Thumbs down'} (↓)`}
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
        <span className="mr-auto self-center text-[11px] text-[var(--color-ink-muted)] flex items-center gap-1.5">
          <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] opacity-80 select-none">
            Esc
          </kbd>
          {t('improve_modal_esc_hint') || 'to close'}
        </span>
        <Button variant="secondary" onClick={onSendOriginal}>
          {t('improve_send_original') || 'Send original'}
          <kbd className="ml-2 text-[10px] font-mono font-normal px-1.5 py-0.5 rounded-[var(--radius-btn)] border border-current opacity-60 select-none">
            Shift+Enter
          </kbd>
        </Button>
        <Button variant="primary" onClick={onSendImproved}>
          {t('improve_send_improved') || 'Send improved'}
          <kbd className="ml-2 text-[10px] font-mono font-normal px-1.5 py-0.5 rounded-[var(--radius-btn)] border border-current opacity-60 select-none">
            Enter
          </kbd>
        </Button>
      </ModalFooter>
    </Modal>
  );
}

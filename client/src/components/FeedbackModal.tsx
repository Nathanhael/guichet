import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useStoreShallow } from '../store/useStore';
import { useT } from '../i18n';
import { trpc } from '../utils/trpc';
import Modal, { ModalBody, ModalFooter, ModalHeader } from './ui/Modal';
import Button from './ui/Button';

interface FeedbackModalProps {
  onClose: () => void;
}

export default function FeedbackModal({ onClose }: FeedbackModalProps) {
  const { user } = useStoreShallow(s => ({ user: s.user }));
  const t = useT();
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);

  const createMutation = trpc.feedback.create.useMutation({
    onSuccess: () => {
      setSent(true);
      setTimeout(onClose, 1500);
    }
  });

  function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!text.trim() || !user) return;
    createMutation.mutate({ text: text.trim() });
  }

  const sending = createMutation.isPending;

  return (
    <Modal open={true} onClose={onClose} id="feedback-modal" maxWidth={440}>
      {sent ? (
        <div className="px-6 py-10 text-center">
          <div className="w-12 h-12 rounded-full bg-[var(--color-ok-soft)] flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="h-6 w-6 text-[var(--color-ok)]" strokeWidth={2} />
          </div>
          <p className="text-[13px] font-medium text-[var(--color-ink)]">{t('feedback_sent')}</p>
        </div>
      ) : (
        <form onSubmit={submit}>
          <ModalHeader
            title={t('feedback')}
            subtitle={t('feedback_desc')}
            onClose={onClose}
          />
          <ModalBody>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('feedback_placeholder')}
              rows={4}
              autoFocus
              className="w-full resize-none rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-2 text-[13px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus:border-[var(--color-accent)]"
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" size="md" type="button" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button variant="primary" size="md" type="submit" disabled={!text.trim() || sending}>
              {sending ? 'Sending…' : t('submit_feedback')}
            </Button>
          </ModalFooter>
        </form>
      )}
    </Modal>
  );
}

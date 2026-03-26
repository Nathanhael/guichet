import React, { useState } from 'react';
import useStore from '../store/useStore';
import { useT } from '../i18n';
import { trpc } from '../utils/trpc';

interface FeedbackModalProps {
  onClose: () => void;
}

export default function FeedbackModal({ onClose }: FeedbackModalProps) {
  const { user } = useStore();
  const t = useT();
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);

  const createMutation = trpc.feedback.create.useMutation({
    onSuccess: () => {
      setSent(true);
      setTimeout(onClose, 1500);
    }
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !user) return;
    
    createMutation.mutate({
      text: text.trim(),
    });
  }

  const sending = createMutation.isPending;

  return (
    <div className="fixed inset-0 bg-bg-base/80 flex items-center justify-center z-50">
      <div className="bg-bg-surface border border-border-heavy p-6 mx-4 max-w-sm w-full">
        {sent ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 border border-border-heavy flex items-center justify-center mx-auto mb-3 text-xl font-bold">✓</div>
            <p className="text-sm font-medium text-text-primary">{t('feedback_sent')}</p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h3 className="text-base font-bold uppercase text-text-primary mb-1">
              {t('feedback')}
            </h3>
            <p className="text-sm text-text-secondary mb-4">
              {t('feedback_desc')}
            </p>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('feedback_placeholder')}
              rows={4}
              autoFocus
              className="input-field mb-4 resize-none"
            />

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={!text.trim() || sending}
                className="flex-1 btn-primary py-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {sending ? 'Sending...' : t('submit_feedback')}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 btn-secondary py-2"
              >
                {t('cancel')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

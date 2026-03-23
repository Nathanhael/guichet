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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-ui-base3 dark:bg-brand-800 rounded-2xl shadow-xl p-6 mx-4 max-w-sm w-full border border-ui-base2 dark:border-brand-700">
        {sent ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-2">&#10003;</div>
            <p className="text-sm font-medium text-ui-base01 dark:text-gray-200">{t('feedback_sent')}</p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h3 className="text-base font-semibold text-ui-base01 dark:text-white mb-1">
              {t('feedback')}
            </h3>
            <p className="text-sm text-ui-base1 dark:text-gray-400 mb-4">
              {t('feedback_desc')}
            </p>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('feedback_placeholder')}
              rows={4}
              autoFocus
              className="w-full border border-ui-base2 dark:border-brand-600 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-brand-500 bg-ui-base3 dark:bg-gray-700 text-ui-base00 dark:text-gray-100 placeholder-ui-base1 resize-none"
            />

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={!text.trim() || sending}
                className="flex-1 bg-brand-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {sending ? 'Sending...' : t('submit_feedback')}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 border border-ui-base2 dark:border-brand-600 text-ui-base01 dark:text-gray-300 py-2 rounded-lg text-sm font-medium hover:bg-ui-base2 dark:hover:bg-brand-700 transition-colors"
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

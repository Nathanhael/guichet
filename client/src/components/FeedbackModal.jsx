import React, { useState } from 'react';
import useStore from '../store/useStore';
import { useT } from '../i18n';

export default function FeedbackModal({ onClose }) {
  const { user } = useStore();
  const t = useT();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          userName: user.name,
          role: user.role,
          text: text.trim(),
        }),
      });
      setSent(true);
      setTimeout(onClose, 1500);
    } catch {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-brand-800 rounded-2xl shadow-xl p-6 mx-4 max-w-sm w-full border border-gray-200 dark:border-brand-700">
        {sent ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-2">&#10003;</div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('feedback_sent')}</p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-1">
              {t('feedback')}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {t('feedback_desc')}
            </p>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('feedback_placeholder')}
              rows={4}
              autoFocus
              className="w-full border border-gray-200 dark:border-brand-600 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 resize-none"
            />

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={!text.trim() || sending}
                className="flex-1 bg-brand-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {t('submit_feedback')}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 border border-gray-200 dark:border-brand-600 text-gray-600 dark:text-gray-300 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-brand-700 transition-colors"
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

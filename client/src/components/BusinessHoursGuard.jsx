import React from 'react';
import useStore from '../store/useStore';
import { useT } from '../i18n';

export default function BusinessHoursGuard({ children }) {
  const { businessHoursOpen } = useStore();
  const t = useT();

  if (!businessHoursOpen) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-brand-900">
        <div className="bg-white dark:bg-brand-800 rounded-2xl shadow-lg p-8 max-w-md text-center">
          <div className="text-5xl mb-4">🕐</div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">{t('expert_chat_closed')}</h2>
          <p className="text-gray-600 dark:text-gray-400">{t('expert_chat_closed_body')}</p>
        </div>
      </div>
    );
  }

  return children;
}

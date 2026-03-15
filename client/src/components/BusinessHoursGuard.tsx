import React from 'react';
import useStore from '../store/useStore';
import { useT } from '../i18n';

interface BusinessHoursGuardProps {
  children: React.ReactNode;
}

export default function BusinessHoursGuard({ children }: BusinessHoursGuardProps) {
  const { businessHoursOpen } = useStore();
  const t = useT();

  if (!businessHoursOpen) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-brand-900">
        <div className="bg-solarized-base3 dark:bg-brand-800 rounded-2xl shadow-lg p-8 max-w-md text-center border border-solarized-base2 dark:border-brand-700">
          <div className="w-16 h-16 bg-solarized-base2 dark:bg-brand-900/50 text-solarized-base01 dark:text-brand-400 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-solarized-base01 dark:text-white mb-2">{t('support_chat_closed')}</h2>
          <p className="text-solarized-base1 dark:text-gray-400">{t('support_chat_closed_body')}</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

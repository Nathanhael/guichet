import React from 'react';

interface InWebsiteErrorProps {
  message: string | null;
  onDismiss: () => void;
  className?: string;
}

export default function InWebsiteError({ message, onDismiss, className = '' }: InWebsiteErrorProps) {
  if (!message) return null;

  return (
    <div className={`overflow-hidden mb-3 ${className}`}>
      <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm flex items-center justify-between shadow-sm">
        <span className="font-medium">{message}</span>
        <button 
          onClick={onDismiss} 
          className="ml-3 text-red-400 hover:text-red-600 dark:hover:text-red-200 font-bold text-lg leading-none transition-colors"
          aria-label="Dismiss error"
        >
          &times;
        </button>
      </div>
    </div>
  );
}

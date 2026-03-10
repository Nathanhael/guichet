import React from 'react';
import MessageBubble from './MessageBubble';

const DEPT_COLOR = {
  DSC: 'bg-purple-100 text-purple-700',
  FOT: 'bg-teal-100 text-teal-700',
};

export default function TicketPreview({ ticket, messages, onJoin, onClose, t, joinDisabled }) {
  return (
    <div className="h-full flex flex-col p-4">
      <div className="bg-white/70 backdrop-blur-md dark:bg-brand-800 rounded-xl shadow-sm border border-gray-200 dark:border-brand-700 flex flex-col h-full">
        {/* Preview header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-brand-700 bg-slate-50/50 dark:bg-brand-900 rounded-t-xl">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${DEPT_COLOR[ticket.dept]}`}>
              {ticket.dept}
            </span>
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{ticket.agentName}</span>
            {ticket.cdbId && (
              <span className="text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded">
                CDBID: {ticket.cdbId}
              </span>
            )}
            {ticket.dareRef && (
              <span className="text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded">
                Dare Ref: {ticket.dareRef}
              </span>
            )}
            <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded font-medium shrink-0">
              Preview — read only
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none ml-2">×</button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {!messages || !Array.isArray(messages) || messages.length === 0 ? (
            <p className="text-center text-gray-400 text-sm mt-8">{t('no_messages')}</p>
          ) : (
            messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} ticketId={ticket.id} />
            ))
          )}
        </div>

        {/* Join bar */}
        <div className="px-4 py-3 border-t border-gray-100 dark:border-brand-700 bg-gray-50 dark:bg-brand-900 rounded-b-xl flex items-center justify-between gap-4">
          {ticket.status === 'closed' ? (
            <p className="text-sm text-gray-400 italic">This conversation has been closed.</p>
          ) : (
            <>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('waiting_for_expert')}</p>
              <button
                onClick={onJoin}
                className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors shrink-0 ${joinDisabled
                  ? 'bg-brand-500/50 text-white/90'
                  : 'bg-brand-500 text-white hover:bg-brand-600'
                  }`}
              >
                {t('join')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

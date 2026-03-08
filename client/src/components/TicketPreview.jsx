import React from 'react';

const DEPT_COLOR = {
  DSC: 'bg-purple-100 text-purple-700',
  FOT: 'bg-teal-100 text-teal-700',
};

export default function TicketPreview({ ticket, messages, onJoin, onClose, t, joinDisabled }) {
  return (
    <div className="h-full flex flex-col p-4">
      <div className="bg-white dark:bg-brand-800 rounded-xl shadow-sm border border-gray-200 dark:border-brand-700 flex flex-col h-full">
        {/* Preview header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-brand-700 bg-gray-50 dark:bg-brand-900 rounded-t-xl">
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
          {messages.length === 0 ? (
            <p className="text-center text-gray-400 text-sm mt-8">{t('no_messages')}</p>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`flex gap-3 px-2 py-1 ${msg.whisper ? 'bg-violet-50/50 dark:bg-violet-900/10 rounded-lg' : ''}`}>
                <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-xs font-semibold text-gray-700 dark:text-gray-200 shrink-0">
                  {(msg.senderName || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{msg.senderName}</span>
                    <span className="text-xs text-gray-400">
                      {new Date(msg.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {msg.whisper && <span className="text-[10px] font-medium uppercase tracking-wider text-violet-500 bg-violet-100 dark:bg-violet-900/50 dark:text-violet-300 px-1.5 py-0.5 rounded leading-none">whisper</span>}
                  </div>
                  <p className={`text-sm break-words whitespace-pre-wrap leading-relaxed ${msg.whisper ? 'text-violet-700 dark:text-violet-300' : 'text-gray-700 dark:text-gray-200'}`}>{msg.text}</p>
                  {msg.translatedText && msg.translatedText !== msg.text && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 italic">{msg.translatedText}</p>
                  )}
                  {msg.mediaUrl && (
                    <img src={msg.mediaUrl} alt="screenshot" className="mt-2 rounded-lg max-w-sm max-h-48 object-contain border border-gray-200 dark:border-brand-600" />
                  )}
                </div>
              </div>
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
                disabled={joinDisabled}
                className="bg-brand-500 text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
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

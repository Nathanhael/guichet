import React from 'react';

export default function ArchiveDrawer({ preview, messages, allLabels, onClose, duration, DEPT_COLOR }) {
    if (!preview) return null;

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-brand-900/40 backdrop-blur-sm transition-opacity animate-fade-in"
                onClick={onClose}
            ></div>

            {/* Drawer Panel */}
            <div className="relative w-full max-w-[550px] bg-white dark:bg-brand-800 shadow-2xl border-l border-gray-200 dark:border-brand-700 h-full flex flex-col animate-slide-in-right">
                <div className="px-6 py-4 border-b border-gray-100 dark:border-brand-700 flex items-start justify-between gap-3 shrink-0 bg-gray-50/50 dark:bg-brand-900/20">
                    <div>
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${DEPT_COLOR[preview.dept]}`}>{preview.dept}</span>
                            <span className="text-base font-bold text-gray-800 dark:text-gray-100">{preview.agentName}</span>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs font-mono text-gray-500 dark:text-gray-400">
                            {preview.cdbId && <span className="bg-gray-100 dark:bg-brand-700 px-2 py-0.5 rounded">CDBID: {preview.cdbId}</span>}
                            {preview.dareRef && <span className="bg-gray-100 dark:bg-brand-700 px-2 py-0.5 rounded">Dare Ref: {preview.dareRef}</span>}
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                            </svg>
                            {preview.expertName ? `Expert: ${preview.expertName}` : 'No expert joined'}
                            <span className="text-gray-300 dark:text-brand-600">•</span>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                            </svg>
                            {duration(preview)}
                        </p>
                        {/* Labels Display */}
                        {preview.labels && preview.labels.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-3">
                                {preview.labels.map(id => {
                                    const info = allLabels.find(l => l.id === id);
                                    if (!info) return null;
                                    return (
                                        <span
                                            key={id}
                                            className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-${info.color}-500/10 text-${info.color}-600 dark:text-${info.color}-400 border border-${info.color}-500/20`}
                                        >
                                            {info.text}
                                        </span>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:bg-brand-700 dark:text-gray-400 dark:hover:bg-brand-600 dark:hover:text-white transition-colors shrink-0"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 bg-gray-50/30 dark:bg-transparent">
                    {messages.length === 0
                        ? <p className="text-center text-gray-400 text-sm mt-8">No messages.</p>
                        : messages.map((msg) => (
                            <div key={msg.id} className={`flex gap-3 px-3 py-2 rounded-xl border border-transparent ${msg.whisper ? 'bg-violet-50 dark:bg-violet-900/10 border-violet-100 dark:border-violet-900/30' : 'hover:bg-gray-50 dark:hover:bg-brand-900/20'}`}>
                                <div className="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-700 flex items-center justify-center text-xs font-bold text-brand-700 dark:text-brand-300 shrink-0 shadow-sm">
                                    {(msg.senderName || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0 pt-0.5">
                                    <div className="flex items-baseline gap-2 mb-1 cursor-default">
                                        <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{msg.senderName}</span>
                                        <span className="text-xs text-gray-400">{new Date(msg.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                                        {msg.whisper && <span className="text-[10px] font-medium uppercase tracking-wider text-violet-500 bg-violet-100 dark:bg-violet-900/50 dark:text-violet-300 px-1.5 py-0.5 rounded leading-none">whisper</span>}
                                    </div>
                                    <p className={`text-[15px] break-words leading-relaxed ${msg.whisper ? 'text-violet-700 dark:text-violet-300' : 'text-gray-700 dark:text-gray-200'}`}>{msg.text}</p>
                                    {msg.mediaUrl && <img src={msg.mediaUrl} alt="screenshot" className="mt-2 rounded-lg max-h-60 object-contain border border-gray-200 dark:border-brand-600 shadow-sm" />}
                                </div>
                            </div>
                        ))
                    }

                    {preview.closingNotes && (
                        <div className="mt-6 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/50 rounded-xl p-4 shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-amber-400/20 to-transparent animate-pulse pointer-events-none" />
                            <h4 className="text-xs font-bold text-amber-800 dark:text-amber-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                </svg>
                                Resolution Notes
                            </h4>
                            <p className="text-[14px] text-amber-900 dark:text-amber-100/80 leading-relaxed whitespace-pre-wrap">{preview.closingNotes}</p>
                            {preview.closedBy && <p className="text-[10px] text-amber-700/60 dark:text-amber-500/50 mt-2 font-medium bg-amber-200/20 px-2 py-0.5 rounded-full w-fit">Closed by: {preview.closedBy}</p>}
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 border-t border-gray-100 dark:border-brand-700 shrink-0 bg-gray-50 dark:bg-brand-900/50">
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400 flex items-center justify-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                        </svg>
                        Read-only archive — conversation closed
                    </p>
                </div>
            </div>
        </div>
    );
}

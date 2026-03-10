import React, { useState } from 'react';

export default function FeedbackList({ feedback, loading, markTreated }) {
    const [showDismissed, setShowDismissed] = useState(false);

    const activeFeedback = feedback.filter(f => !f.treated);
    const dismissedFeedback = feedback.filter(f => f.treated);

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="space-y-3">
                {loading ? (
                    <p className="text-gray-400 text-sm">Loading...</p>
                ) : activeFeedback.length === 0 ? (
                    <div className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 p-8 text-center shadow-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-brand-200 dark:text-brand-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">All caught up! No active feedback.</p>
                    </div>
                ) : (
                    activeFeedback.map((f) => (
                        <div key={f.id} className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 p-5 shadow-sm hover:shadow-md transition-all group animate-slide-up">
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-100 to-brand-200 dark:from-brand-800 dark:to-brand-700 flex items-center justify-center text-sm font-bold text-brand-700 dark:text-brand-300 shadow-inner">
                                        {(f.userName || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{f.userName}</span>
                                            <span className="text-[10px] font-bold uppercase tracking-wider bg-gray-100 dark:bg-brand-900/50 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded">{f.role}</span>
                                        </div>
                                        <span className="text-xs text-gray-400">
                                            {new Date(f.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => markTreated(f.id)}
                                    className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-green-600 bg-gray-50 hover:bg-green-50 dark:bg-brand-900/30 dark:hover:bg-green-900/30 dark:border-brand-800 border border-gray-100 px-3 py-1.5 rounded-lg transition-all shadow-sm"
                                    title="Mark as treated"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                    Dismiss
                                </button>
                            </div>
                            <p className="text-[15px] text-gray-700 dark:text-gray-300 leading-relaxed pl-13">{f.text}</p>
                        </div>
                    ))
                )}
            </div>

            {/* Dismissed Feedback Accordion */}
            {dismissedFeedback.length > 0 && (
                <div className="mt-8 border-t border-gray-200 dark:border-brand-700/50 pt-6">
                    <button
                        onClick={() => setShowDismissed(!showDismissed)}
                        className="w-full flex items-center justify-between text-left p-4 rounded-xl bg-gray-50 dark:bg-brand-900/40 hover:bg-gray-100 dark:hover:bg-brand-800/60 transition-colors border border-gray-100 dark:border-brand-800/50"
                    >
                        <div className="flex items-center gap-3">
                            <span className="text-sm font-bold text-gray-700 dark:text-gray-300">Dismissed Feedback</span>
                            <span className="bg-white dark:bg-brand-800 text-gray-500 dark:text-gray-400 text-xs font-semibold px-2.5 py-1 rounded-full shadow-sm">{dismissedFeedback.length}</span>
                        </div>
                        <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 text-gray-400 transition-transform duration-300 ${showDismissed ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>

                    {showDismissed && (
                        <div className="mt-3 space-y-3 animate-slide-up">
                            {dismissedFeedback.map((f) => (
                                <div key={f.id} className="bg-white/60 dark:bg-brand-800/60 rounded-xl border border-gray-100 dark:border-brand-700/50 p-4 opacity-75 backdrop-blur-sm">
                                    <div className="flex items-start justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">{f.userName}</span>
                                            <span className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500">{f.role}</span>
                                            <span className="text-xs bg-green-100/50 text-green-700 dark:bg-green-900/20 dark:text-green-500 px-2 py-0.5 rounded-full flex items-center gap-1 font-medium ring-1 ring-green-200/50 dark:ring-green-800/30">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                                Treated
                                            </span>
                                        </div>
                                        <span className="text-xs text-gray-400">
                                            {new Date(f.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-500 dark:text-gray-400 whitespace-pre-wrap">{f.text}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

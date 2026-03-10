import React from 'react';
import Panel from '../shared/Panel';

export default function DaySummary({ daySummary }) {
    if (!daySummary) return null;

    const depts = [
        { id: 'DSC', name: 'Digital Service Center', color: 'purple' },
        { id: 'FOT', name: 'Fiber Ops Team', color: 'teal' }
    ];

    return (
        <Panel title="Topic Summary (Top Labels)">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {depts.map(dept => (
                    <div key={dept.id} className="relative">
                        <div className="flex items-center gap-3 mb-4">
                            <div className={`w-1.5 h-6 rounded-full bg-${dept.color}-500 shadow-sm shadow-${dept.color}-500/50`} />
                            <h3 className="text-sm font-bold text-slate-700 dark:text-gray-200 uppercase tracking-widest">
                                {dept.id}
                            </h3>
                            <div className="h-px flex-1 bg-slate-100 dark:bg-brand-800/50 ml-2" />
                        </div>

                        <div className="space-y-2.5">
                            {daySummary[dept.id] && daySummary[dept.id].length > 0 ? (
                                daySummary[dept.id].map((tag, idx) => (
                                    <div
                                        key={idx}
                                        className="flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-brand-900/20 border border-slate-100 dark:border-brand-700/50 rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-300"
                                    >
                                        <span className="text-[10px] font-black text-slate-400 tabular-nums w-4">0{idx + 1}</span>
                                        <span className="text-xs font-bold text-slate-700 dark:text-gray-200">{tag}</span>
                                        <div className="ml-auto flex gap-1.5">
                                            <div className={`w-1.5 h-1.5 rounded-full bg-${dept.color}-500/40`} />
                                            <div className={`w-1.5 h-1.5 rounded-full bg-${dept.color}-500/20`} />
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className="text-xs text-gray-400 italic py-2">No specific trends identified.</p>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-6 border-t border-gray-50 dark:border-brand-700 pt-3 italic">
                * Based on the most frequently assigned labels for the selected period.
            </p>
        </Panel>
    );
}

import React from 'react';
import Panel from '../shared/Panel';

export default function QueueHealth({ stats }) {
    if (!stats) return null;


    return (
        <Panel title="Queue health">
            <div className="grid grid-cols-2 gap-3 mb-3">
                <div className={`rounded-lg p-3 ${stats.oldestWaitMinutes > 3 ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800' : 'bg-gray-50 dark:bg-gray-700'}`}>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Oldest waiting</p>
                    <p className={`text-2xl font-bold mt-0.5 ${stats.oldestWaitMinutes > 3 ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-white'}`}>
                        {stats.oldestWaitMinutes > 0 ? `${stats.oldestWaitMinutes}m` : '—'}
                    </p>
                </div>
                <div className={`rounded-lg p-3 ${stats.waitingOver3 > 0 ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800' : 'bg-gray-50 dark:bg-gray-700'}`}>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Waiting &gt;3 min</p>
                    <p className={`text-2xl font-bold mt-0.5 ${stats.waitingOver3 > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-800 dark:text-white'}`}>
                        {stats.waitingOver3}
                    </p>
                </div>
            </div>

            {/* Dept SLA Breakdown */}
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                <p className="text-[10px] uppercase font-bold text-gray-400 mb-2 tracking-wider">Dept SLA Health</p>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <div className="flex justify-between items-end mb-1">
                            <span className="text-[10px] font-bold text-purple-600">DSC</span>
                            <span className={`text-xs font-bold ${stats.deptSla?.DSC >= 90 ? 'text-emerald-500' : 'text-rose-500'}`}>{stats.deptSla?.DSC}%</span>
                        </div>
                        <div className="h-1 w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div className="h-full bg-purple-500" style={{ width: `${stats.deptSla?.DSC}%` }} />
                        </div>
                    </div>
                    <div>
                        <div className="flex justify-between items-end mb-1">
                            <span className="text-[10px] font-bold text-teal-600">FOT</span>
                            <span className={`text-xs font-bold ${stats.deptSla?.FOT >= 90 ? 'text-emerald-500' : 'text-rose-500'}`}>{stats.deptSla?.FOT}%</span>
                        </div>
                        <div className="h-1 w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div className="h-full bg-teal-500" style={{ width: `${stats.deptSla?.FOT}%` }} />
                        </div>
                    </div>
                </div>
            </div>
        </Panel>
    );
}

import React from 'react';
import Panel from '../shared/Panel';
import { Statistics } from '../../../types';

interface DeptDistributionProps {
    stats: Statistics | null;
}

export default function DeptDistribution({ stats }: DeptDistributionProps) {
    if (!stats) return null;

    const total = (stats.globalDscCount || 0) + (stats.globalFotCount || 0);
    const dscPct = total > 0 ? Math.round((stats.globalDscCount! / total) * 100) : 0;
    const fotPct = total > 0 ? Math.round((stats.globalFotCount! / total) * 100) : 0;

    return (
        <Panel title="DSC vs FOT Distribution">
            <div className="grid grid-cols-1 gap-4 mt-2">
                <div>
                    <div className="flex justify-between items-end mb-1">
                        <span className="text-xs font-bold text-purple-600">DSC</span>
                        <span className="text-sm font-bold text-purple-600 dark:text-purple-400">{dscPct}%</span>
                    </div>
                    <div className="h-2 w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden shadow-inner">
                        <div className="h-full bg-purple-500 transition-all duration-500" style={{ width: `${dscPct}%` }} />
                    </div>
                </div>
                <div>
                    <div className="flex justify-between items-end mb-1">
                        <span className="text-xs font-bold text-teal-600">FOT</span>
                        <span className="text-sm font-bold text-teal-600 dark:text-teal-400">{fotPct}%</span>
                    </div>
                    <div className="h-2 w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden shadow-inner">
                        <div className="h-full bg-teal-500 transition-all duration-500" style={{ width: `${fotPct}%` }} />
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-4 mt-6 pt-4 border-t border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                    <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">DSC Total: {stats.globalDscCount || 0}</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                    <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">FOT Total: {stats.globalFotCount || 0}</span>
                </div>
            </div>
        </Panel>
    );
}

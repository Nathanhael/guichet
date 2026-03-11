import React from 'react';
import Panel from '../shared/Panel';
import { OnlineExpert } from '../../../types';

interface OnlineExpertsProps {
    onlineExperts: OnlineExpert[];
}

export default function OnlineExperts({ onlineExperts }: OnlineExpertsProps) {
    return (
        <Panel title={`Online now (${onlineExperts.length})`}>
            {onlineExperts.length === 0 ? (
                <p className="text-sm text-gray-400">No experts online</p>
            ) : (
                <div className="flex flex-wrap gap-2">
                    {onlineExperts.map((e) => (
                        <div key={e.userId} title={`${e.name} · ${e.status || 'available'}`} className="relative group flex items-center gap-2 bg-gray-50 dark:bg-gray-700 border border-gray-100 dark:border-brand-600 rounded-full pl-1.5 pr-4 py-1.5 cursor-default">
                            <div className="w-6 h-6 rounded-full bg-brand-100 dark:bg-brand-900/50 flex items-center justify-center text-xs font-bold text-brand-600 dark:text-brand-400 shrink-0">
                                {e.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-200 leading-none truncate max-w-[120px]">
                                {e.name}
                            </span>
                            <span className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-white dark:ring-gray-800 ${e.status === 'break' ? 'bg-yellow-400' : e.status === 'lunch' ? 'bg-orange-400' : e.status === 'meeting' ? 'bg-gray-400' : 'bg-green-400'}`} />
                        </div>
                    ))}
                </div>
            )}
        </Panel>
    );
}

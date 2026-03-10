import React from 'react';

export default function ChartTooltip({ active, payload, label, titleFormatter }) {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white/95 dark:bg-brand-900/95 backdrop-blur-md border border-slate-200 dark:border-brand-700 p-3 rounded-2xl shadow-2xl ring-1 ring-black/5 dark:ring-white/5 min-w-[140px] animate-in fade-in zoom-in duration-200">
                <p className="text-[10px] font-black text-slate-400 dark:text-brand-400 uppercase tracking-widest mb-2 border-b border-slate-100 dark:border-brand-800 pb-1.5 flex items-center justify-between">
                    <span>{titleFormatter ? titleFormatter(label) : label}</span>
                </p>
                <div className="space-y-2">
                    {payload.map((entry, index) => (
                        <div key={index} className="flex items-center gap-3 group">
                            <div
                                className="w-2 h-2 rounded-full shadow-sm shrink-0"
                                style={{ backgroundColor: entry.color || entry.fill }}
                            />
                            <span className="text-[11px] font-bold text-slate-600 dark:text-gray-300 transition-colors">
                                {entry.name}:
                            </span>
                            <span className="text-[11px] font-black text-slate-900 dark:text-white ml-auto tabular-nums">
                                {entry.value}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        );
    }
    return null;
}

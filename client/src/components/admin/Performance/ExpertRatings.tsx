import React, { useState } from 'react';
import { Star, Activity, ShieldCheck } from 'lucide-react';
import Panel from '../shared/Panel';

interface ExpertStat {
    name: string;
    total: number;
    avgRating?: number;
    depts?: string[];
    deptRatings?: Record<string, number>;
}

interface ExpertRatingsProps {
    expertStats: ExpertStat[];
    className?: string;
}

export default function ExpertRatings({ expertStats = [], className = '' }: ExpertRatingsProps) {
    const [hoveredExpert, setHoveredExpert] = useState<string | null>(null);

    if (!expertStats || expertStats.length === 0) return null;

    const renderStars = (rating: number | undefined, label?: string) => {
        const hasRating = rating != null;

        return (
            <div className="flex flex-col gap-1">
                {label && (
                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase w-fit ${label === 'DSC' ? 'bg-purple-500/10 text-purple-500 border border-purple-500/20' :
                        label === 'FOT' ? 'bg-teal-500/10 text-teal-500 border border-teal-500/20' :
                            'bg-slate-500/10 text-slate-500 border border-slate-500/20'
                        }`}>
                        {label}
                    </span>
                )}
                <div className="flex items-center gap-0.5">
                    {!hasRating ? (
                        <span className="text-[9px] text-slate-400 italic">No ratings</span>
                    ) : (
                        <>
                            {[1, 2, 3, 4, 5].map((s) => (
                                <Star
                                    key={s}
                                    size={9}
                                    className={s <= Math.round(rating!) ? 'fill-current text-amber-400' : 'text-slate-300 dark:text-slate-700'}
                                />
                            ))}
                            <span className="text-[9px] font-black text-slate-600 dark:text-slate-400 ml-1">{rating}</span>
                        </>
                    )}
                </div>
            </div>
        );
    };

    const colors = [
        '#6366f1', '#ec4899', '#8b5cf6', '#10b981', '#f59e0b',
        '#3b82f6', '#ef4444', '#06b6d4', '#84cc16', '#d946ef'
    ];

    return (
        <Panel title="Expert Insights" badge="Ratings per Domain" className={className}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {expertStats.map((expert, index) => {
                    const color = colors[index % colors.length];
                    const isHovered = hoveredExpert === expert.name;

                    // Filter out 'Unknown' if there are other depts
                    const displayDepts = expert.depts?.filter(d => d !== 'Unknown') || [];
                    const showSplit = displayDepts.length > 0;

                    return (
                        <div
                            key={expert.name}
                            onMouseEnter={() => setHoveredExpert(expert.name)}
                            onMouseLeave={() => setHoveredExpert(null)}
                            className={`p-3 rounded-xl border transition-all duration-300 flex items-start gap-3 ${isHovered ? 'bg-slate-100/10 border-white/20 shadow-lg' : 'bg-white/5 border-white/5'
                                }`}
                        >
                            <div className="relative mt-1">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-black text-sm shadow-inner`} style={{ backgroundColor: color }}>
                                    {expert.name.charAt(0)}
                                </div>
                                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-slate-900 flex items-center justify-center">
                                    <ShieldCheck size={10} className="text-white" />
                                </div>
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-xs font-black text-slate-700 dark:text-white truncate uppercase tracking-tight">{expert.name}</p>
                                    <div className="flex items-center gap-1 opacity-60">
                                        <Activity size={10} className="text-slate-400" />
                                        <span className="text-[10px] font-bold text-slate-500">{expert.total}</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    {showSplit ? (
                                        displayDepts.map(dept => {
                                            const rating = expert.deptRatings?.[dept];
                                            return (
                                                <div key={dept}>
                                                    {renderStars(rating, dept)}
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div className="col-span-2">
                                            {renderStars(expert.avgRating, 'Overall')}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </Panel>
    );
}

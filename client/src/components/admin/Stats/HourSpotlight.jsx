import React from 'react';
import { Users, Clock, ShieldCheck, Trophy } from 'lucide-react';
import Panel from '../shared/Panel';

export default function HourSpotlight({ hourData, expertStats, className = '' }) {
    if (!hourData) {
        return (
            <Panel title="Hour Spotlight" badge="Select an hour" className={`flex flex-col ${className}`}>
                <div className="flex-1 flex flex-col items-center justify-center py-10 opacity-40">
                    <Clock size={32} className="mb-2 text-slate-400" />
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 text-center">
                        Click a bar on the charts to explore
                    </p>
                </div>
            </Panel>
        );
    }

    const { hour, tickets, experts, slaHealth, topExpertId, topExpertCount } = hourData;
    const formatHour = (h) => `${String(h).padStart(2, '0')}:00`;

    // Find top expert name
    const topExpert = expertStats?.find(e => e.id === topExpertId);

    const getSLAColor = (val) => {
        if (val >= 90) return 'text-emerald-500';
        if (val >= 70) return 'text-amber-500';
        return 'text-red-500';
    };

    const workload = experts > 0 ? (tickets / experts).toFixed(1) : (tickets > 0 ? '∞' : '0');

    const getWorkloadInfo = (ratio) => {
        if (ratio === '∞') return { label: 'CRITICAL', color: 'text-red-500', bg: 'bg-red-500/10' };
        const val = parseFloat(ratio);
        if (val === 0) return { label: 'NO LOAD', color: 'text-slate-400', bg: 'bg-slate-400/10' };
        if (val < 3) return { label: 'OPTIMAL', color: 'text-emerald-500', bg: 'bg-emerald-500/10' };
        if (val <= 8) return { label: 'BALANCED', color: 'text-indigo-500', bg: 'bg-indigo-500/10' };
        if (val <= 12) return { label: 'HIGH TENSION', color: 'text-amber-500', bg: 'bg-amber-500/10' };
        return { label: 'CRITICAL', color: 'text-red-500', bg: 'bg-red-500/10' };
    };

    const workloadInfo = getWorkloadInfo(workload);

    return (
        <Panel title={`Hour Spotlight: ${formatHour(hour)}`} badge="Drill-down" className={`flex flex-col ${className}`}>
            <div className="flex-1 flex flex-col justify-between py-2">
                {/* Workload Section */}
                <div className={`p-4 rounded-xl border border-white/5 mb-4 text-center ${workloadInfo.bg}`}>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Standard Workload</p>
                    <div className="flex items-center justify-center gap-2">
                        <p className={`text-3xl font-black ${workloadInfo.color}`}>{workload}</p>
                        <div className="text-left">
                            <p className="text-[10px] font-bold text-slate-500 leading-none">Tickets</p>
                            <p className="text-[10px] font-bold text-slate-500 leading-none">per expert</p>
                        </div>
                    </div>
                    <p className={`text-[10px] font-black mt-2 tracking-widest ${workloadInfo.color}`}>{workloadInfo.label}</p>
                </div>

                {/* Context Grid */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="p-3 bg-slate-50/5 dark:bg-slate-900/10 rounded-xl border border-white/5">
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Typical Vol.</p>
                        <p className="text-xl font-black text-slate-700 dark:text-slate-300">{tickets}</p>
                        <p className="text-[9px] text-slate-500 font-medium italic">Avg. tickets</p>
                    </div>

                    <div className="p-3 bg-slate-50/5 dark:bg-slate-900/10 rounded-xl border border-white/5">
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Avg. Staff</p>
                        <p className="text-xl font-black text-slate-700 dark:text-slate-300">{experts}</p>
                        <p className="text-[9px] text-slate-500 font-medium italic">Experts/day</p>
                    </div>
                </div>

                {/* SLA Section */}
                <div className="p-3 bg-emerald-50/5 dark:bg-emerald-900/10 rounded-xl border border-emerald-500/10">
                    <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 text-emerald-400">
                            <ShieldCheck size={12} />
                            <span className="text-[10px] font-black uppercase tracking-widest">Service Level</span>
                        </div>
                        <p className={`text-lg font-black ${getSLAColor(slaHealth)}`}>{slaHealth}%</p>
                    </div>
                    <div className="w-full h-1 bg-white/10 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-500 ${slaHealth >= 90 ? 'bg-emerald-500' : slaHealth >= 70 ? 'bg-amber-500' : 'bg-red-500'}`}
                            style={{ width: `${slaHealth}%` }}
                        />
                    </div>
                </div>
            </div>
        </Panel>
    );
}

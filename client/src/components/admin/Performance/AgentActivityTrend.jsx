import React from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import Panel from '../shared/Panel';

export default function AgentActivityTrend({ agentStats, className = '' }) {
    const [hoveredAgent, setHoveredAgent] = React.useState(null);
    const [activeAgent, setActiveAgent] = React.useState(null);

    if (!agentStats || agentStats.length === 0) {
        return (
            <Panel title="Agent Activity Trend" className={className}>
                <p className="text-sm text-gray-400 text-center py-8 font-medium italic">No performance data available yet</p>
            </Panel>
        );
    }

    // Transform data for Multi-Line Chart
    const dateMap = {};
    const agentNames = agentStats.map(a => a.name);

    agentStats.forEach(agent => {
        agent.trend?.forEach(t => {
            if (!dateMap[t.date]) {
                dateMap[t.date] = { date: t.date };
                agentNames.forEach(name => {
                    dateMap[t.date][name] = 0;
                });
            }
            dateMap[t.date][agent.name] = t.count;
        });
    });

    const chartData = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));

    // Colors for different lines (using same palette as experts for consistency)
    const colors = [
        '#6366f1', '#ec4899', '#8b5cf6', '#10b981', '#f59e0b',
        '#3b82f6', '#ef4444', '#06b6d4', '#84cc16', '#d946ef'
    ];

    return (
        <Panel title="Agent Activity Trend" badge="Volume" className={`flex flex-col ${className}`}>
            <div className="flex-1 flex flex-col gap-6">
                <div className="relative">
                    <div className="flex flex-wrap justify-end gap-2 mb-4">
                        {agentNames.map((name, index) => {
                            const color = colors[index % colors.length];
                            const isFocused = activeAgent === name || hoveredAgent === name;
                            return (
                                <button
                                    key={name}
                                    onClick={() => setActiveAgent(activeAgent === name ? null : name)}
                                    onMouseEnter={() => setHoveredAgent(name)}
                                    onMouseLeave={() => setHoveredAgent(null)}
                                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full transition-all duration-200 border ${isFocused
                                        ? 'bg-slate-100/10 dark:bg-slate-700/40 border-slate-200/20 dark:border-slate-600/30'
                                        : 'border-transparent opacity-40 hover:opacity-100'
                                        }`}
                                >
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                                    <span className="text-[9px] font-black uppercase tracking-widest">{name}</span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="h-[280px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }} onClick={() => setActiveAgent(null)}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} opacity={0.1} />
                                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#64748b', fontWeight: 700 }} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#64748b', fontWeight: 700 }} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '12px', fontSize: '11px', color: '#fff' }}
                                />
                                {agentNames.map((name, index) => {
                                    const isFocused = activeAgent === name || hoveredAgent === name;
                                    const isAnyActive = activeAgent !== null || hoveredAgent !== null;
                                    const isDimmed = isAnyActive && !isFocused;
                                    return (
                                        <Line
                                            key={name}
                                            type="monotone"
                                            dataKey={name}
                                            stroke={colors[index % colors.length]}
                                            strokeWidth={isFocused ? 4 : 2}
                                            strokeOpacity={isDimmed ? 0.1 : 1}
                                            dot={isFocused ? { r: 4, strokeWidth: 2, fill: '#fff' } : { r: 2, fill: '#fff', opacity: isDimmed ? 0.1 : 0.6 }}
                                            activeDot={{ r: 5, strokeWidth: 0 }}
                                            animationDuration={500}
                                        />
                                    );
                                })}
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            <div className="mt-4 text-[10px] text-slate-400 font-medium italic flex justify-between border-t border-white/5 pt-3">
                <span>Click an agent to lock focus, click background to reset</span>
                <span>Period activity per agent</span>
            </div>
        </Panel>
    );
}

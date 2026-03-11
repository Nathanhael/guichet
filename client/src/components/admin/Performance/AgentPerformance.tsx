import React from 'react';
import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar } from 'recharts';
import Panel from '../shared/Panel';
import ChartTooltip from '../shared/ChartTooltip';
import { AgentStat } from '../../../types';

interface AgentPerformanceProps {
    agentStats: AgentStat[];
}

export default function AgentPerformance({ agentStats }: AgentPerformanceProps) {
    if (!agentStats || agentStats.length === 0) {
        return (
            <Panel title="Agent performance">
                <p className="text-sm text-gray-400 text-center py-8 font-medium italic">No agent statistics available</p>
            </Panel>
        );
    }

    return (
        <Panel title="Agent performance">
            <div className="max-h-[320px] overflow-y-auto pr-2 custom-scrollbar animate-fade-in">
                <ResponsiveContainer width="100%" height={Math.max(160, agentStats.length * 40)}>
                    <BarChart
                        data={agentStats}
                        layout="vertical"
                        margin={{ top: 0, right: 30, left: 10, bottom: 0 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <YAxis
                            type="category"
                            dataKey="name"
                            tick={{ fontSize: 11, fontWeight: 'bold', fill: '#64748b' }}
                            width={140}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f5f933' }} />
                        <span className="hidden">
                            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
                        </span>
                        <Bar
                            dataKey="total"
                            fill="#f59e0b"
                            radius={[0, 4, 4, 0]}
                            name="Period Total"
                            barSize={12}
                        />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </Panel>
    );
}

import React from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import Panel from '../shared/Panel';
import ChartTooltip from '../shared/ChartTooltip';
import { Statistics } from '../../../types';

interface PerformanceTrendsProps {
    stats: Statistics | null;
}

export default function PerformanceTrends({ stats }: PerformanceTrendsProps) {
    if (!stats || !stats.dailyTrend) return null;

    const label = stats.trendGranularity === 'weekly'
        ? `${stats.dailyTrend.length} weeks`
        : stats.trendGranularity === 'monthly'
            ? `${stats.dailyTrend.length} months`
            : `${stats.dailyTrend.length} days`;

    return (
        <Panel title={`Tickets Trend (${label})`}>
            <ResponsiveContainer width="100%" height={220}>
                <LineChart data={stats.dailyTrend} margin={{ top: 12, right: 12, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} axisLine={false} tickLine={false} interval={Math.ceil(stats.dailyTrend.length / 10)} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
                    <Line type="monotone" dataKey="total" stroke="#e24e1b" strokeWidth={3} dot={{ r: 3, fill: '#e24e1b', strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 0 }} name="Total" />
                    <Line type="monotone" dataKey="dsc" stroke="#a855f7" strokeWidth={2} dot={{ r: 2, fill: '#a855f7', strokeWidth: 0 }} activeDot={{ r: 4, strokeWidth: 0 }} name="DSC" />
                    <Line type="monotone" dataKey="fot" stroke="#14b8a6" strokeWidth={2} dot={{ r: 2, fill: '#14b8a6', strokeWidth: 0 }} activeDot={{ r: 4, strokeWidth: 0 }} name="FOT" />
                </LineChart>
            </ResponsiveContainer>
        </Panel>
    );
}

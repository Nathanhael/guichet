import React from 'react';
import StatCard from '../shared/StatCard';

export default function StatsOverview({ stats }) {
    if (!stats) return null;

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            <StatCard label="Total Tickets" value={stats.total} color="dark" prev={stats.previousPeriod?.total} />
            <StatCard label="Response Time" value={stats.avgResponseMinutes > 0 ? `${stats.avgResponseMinutes}m` : '—'} color="gray" prev={stats.previousPeriod?.avgResponseMinutes > 0 ? `${stats.previousPeriod.avgResponseMinutes}m` : undefined} invertTrend />
            <StatCard label="Avg Duration" value={stats.avgDurationMinutes > 0 ? `${stats.avgDurationMinutes}m` : '—'} color="gray" prev={stats.previousPeriod?.avgDurationMinutes > 0 ? `${stats.previousPeriod.avgDurationMinutes}m` : undefined} invertTrend />
            <StatCard label="Satisfaction" value={stats.avgRating > 0 ? `${stats.avgRating}` : '—'} color="yellow" prev={stats.previousPeriod?.avgRating} />
            <StatCard label="Abandoned" value={stats.abandonedCount} color="red" prev={stats.previousPeriod?.abandonedCount} invertTrend />
            <StatCard
                label="SLA Health"
                value={`${stats.slaHealth}%`}
                color={stats.slaHealth >= 90 ? 'teal' : stats.slaHealth >= 70 ? 'yellow' : 'red'}
                prev={stats.previousPeriod?.slaHealth != null ? `${stats.previousPeriod.slaHealth}%` : undefined}
                tooltip="Percentage of tickets meeting the response time target."
            />
            <StatCard
                label="Resol. Rate"
                value={`${stats.resolutionRate}%`}
                color="purple"
                tooltip="Percentage of tickets successfully resolved."
            />
            <StatCard
                label="Concurrency"
                value={stats.avgConcurrency}
                color="teal"
                tooltip="Average number of tickets handled per unique expert in this period."
            />
        </div>
    );
}

import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import Panel from '../shared/Panel';
import ChartTooltip from '../shared/ChartTooltip';

export default function PeakHours({ hourlyDistribution, activeHour, onHourClick, className = '' }) {
    if (!hourlyDistribution || hourlyDistribution.length === 0) {
        return (
            <Panel title="Peak Hours Distribution" className={className}>
                <p className="text-sm text-gray-400 text-center py-8 font-medium italic">No ticket distribution data</p>
            </Panel>
        );
    }

    const handleChartClick = (state) => {
        if (state && state.activePayload) {
            const h = state.activePayload[0].payload.hour;
            onHourClick?.(h === activeHour ? null : h);
        }
    };

    return (
        <Panel title="Peak Hours Distribution" badge="Activity" className={`flex flex-col ${className}`}>
            <div className="flex-1 min-h-[220px] w-full cursor-pointer">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                        data={hourlyDistribution}
                        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                        onClick={handleChartClick}
                    >
                        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" vertical={false} />
                        <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(h) => `${h}h`} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} axisLine={false} tickLine={false} />
                        <Tooltip content={<ChartTooltip titleFormatter={(h) => `${h}:00`} />} cursor={{ fill: '#f1f5f933' }} />
                        <Bar dataKey="count" fill="#e24e1b" radius={[4, 4, 0, 0]} name="Tickets" barSize={20}>
                            {hourlyDistribution.map((entry, index) => (
                                <Cell
                                    key={`cell-${index}`}
                                    fill={activeHour !== null && activeHour !== entry.hour ? '#e24e1b33' : '#e24e1b'}
                                />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </Panel>
    );
}

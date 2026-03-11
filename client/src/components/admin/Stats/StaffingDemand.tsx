import { HourlyStat } from '../../../types';

interface StaffingDemandProps {
    hourlyStaffing: HourlyStat[];
    activeHour: number | null;
    onHourClick: (hour: number | null) => void;
    className?: string;
}

export default function StaffingDemand({ hourlyStaffing, activeHour, onHourClick, className = '' }: StaffingDemandProps) {
    if (!hourlyStaffing || hourlyStaffing.length === 0) return null;

    const formatHour = (h: number) => `${String(h).padStart(2, '0')}:00`;

    const chartData = hourlyStaffing.map(item => ({
        ...item,
        time: formatHour(item.hour),
        loadFactor: item.experts > 0 ? (item.tickets / item.experts).toFixed(1) : 0,
        isBusinessHour: item.hour >= 7 && item.hour <= 22
    }));

    const handleChartClick = (state: any) => {
        if (state && state.activePayload) {
            const h = state.activePayload[0].payload.hour;
            onHourClick?.(h === activeHour ? null : h);
        }
    };

    const activeHours = chartData.filter(h => h.experts > 0);
    const businessHoursWithStaff = chartData.filter(h => h.isBusinessHour && h.experts > 0).length;
    const coveragePercent = Math.min(100, Math.round((businessHoursWithStaff / 15) * 100));
    const peakDemandHour = chartData.reduce((prev, current) => (prev.tickets > current.tickets ? prev : current), chartData[0]);
    const maxLoadHour = chartData.reduce((prev, current) => {
        return parseFloat(String(prev.loadFactor)) > parseFloat(String(current.loadFactor)) ? prev : current;
    }, chartData[0]);

    const getEfficiency = () => {
        const totalTickets = chartData.reduce((a, b) => a + b.tickets, 0);
        if (totalTickets === 0) return { label: 'No Data', color: 'text-slate-400', bg: 'bg-slate-500/10', desc: '' };
        const criticalHours = chartData.filter(h => h.isBusinessHour && h.tickets > 0 && h.experts === 0).length;
        const avgLoad = activeHours.reduce((a, b) => a + parseFloat(String(b.loadFactor)), 0) / (activeHours.length || 1);
        if (criticalHours > 1) return { label: 'Critical Gap', color: 'text-red-500', bg: 'bg-red-500/10', desc: `${criticalHours} bus. hours with 0 staff.` };
        if (parseFloat(String(maxLoadHour.loadFactor)) > 8) return { label: 'High Tension', color: 'text-amber-500', bg: 'bg-amber-500/10', desc: 'Experts handling >8 tickets at peak.' };
        if (avgLoad < 3.5) return { label: 'Optimal', color: 'text-emerald-500', bg: 'bg-emerald-500/10', desc: 'Staffing matches demand perfectly.' };
        return { label: 'Balanced', color: 'text-indigo-500', bg: 'bg-indigo-500/10', desc: 'Reasonable coverage for existing volume.' };
    };
    const efficiency = getEfficiency();

    return (
        <Panel title="Staffing vs Demand Analysis" className={`flex flex-col ${className}`}>
            <div className="flex-1 min-h-[400px] w-full mt-4 cursor-pointer">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                        data={chartData}
                        margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                        onClick={handleChartClick}
                    >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} opacity={0.3} />

                        <ReferenceArea
                            x1="07:00"
                            x2="23:00"
                            fill="rgba(99, 102, 241, 0.05)"
                            label={{ position: 'top', value: 'Business Hours', fill: '#6366f1', fontSize: 10, fontWeight: 'bold' } as any}
                        />

                        <XAxis
                            dataKey="time"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 10, fill: '#64748b', fontWeight: 600 } as any}
                        />
                        <YAxis
                            yAxisId="left"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 10, fill: '#818cf8', fontWeight: 600 } as any}
                            label={{ value: 'Questions', angle: -90, position: 'insideLeft', offset: 15, fontSize: 10, fill: '#818cf8' } as any}
                        />
                        <YAxis
                            yAxisId="right"
                            orientation="right"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 10, fill: '#f472b6', fontWeight: 600 } as any}
                            label={{ value: 'Experts', angle: 90, position: 'insideRight', offset: 15, fontSize: 10, fill: '#f472b6' } as any}
                        />
                        <Tooltip
                            content={({ active, payload, label }) => {
                                if (!active || !payload || !payload.length) return null;
                                const data = payload[0].payload;
                                const ratio = parseFloat(String(data.loadFactor));

                                const getStatus = (val: number) => {
                                    if (data.experts === 0 && data.tickets > 0) return { label: 'CRITICAL (NO STAFF)', color: 'text-red-400' };
                                    if (val < 3) return { label: 'OPTIMAL LOAD', color: 'text-emerald-400' };
                                    if (val <= 8) return { label: 'BALANCED LOAD', color: 'text-indigo-400' };
                                    if (val <= 12) return { label: 'HIGH TENSION', color: 'text-amber-400' };
                                    return { label: 'CRITICAL OVERLOAD', color: 'text-red-400' };
                                };
                                const status = getStatus(ratio);

                                return (
                                    <div className="bg-slate-900/95 backdrop-blur-md p-3 rounded-xl border border-white/10 shadow-2xl min-w-[140px]">
                                        <p className="text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">{label}</p>
                                        <div className="mb-2 pb-2 border-b border-white/5 text-center">
                                            <p className={`text-xl font-black ${status.color}`}>{data.loadFactor}</p>
                                            <p className={`text-[9px] font-black uppercase tracking-tighter ${status.color}`}>{status.label}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <div className="flex justify-between items-center gap-4">
                                                <span className="text-[10px] text-slate-400 font-bold uppercase">Volume</span>
                                                <span className="text-xs font-black text-indigo-400">{data.tickets}</span>
                                            </div>
                                            <div className="flex justify-between items-center gap-4">
                                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">Staff</span>
                                                <span className="text-xs font-black text-pink-400">{data.experts}</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            }}
                        />
                        <Legend
                            verticalAlign="top"
                            align="right"
                            height={36}
                            iconType="circle"
                            wrapperStyle={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                        />
                        <Bar
                            yAxisId="left"
                            dataKey="tickets"
                            name="Demand (Questions)"
                            radius={[4, 4, 0, 0]}
                            barSize={30}
                            fill="#6366f1"
                        >
                            {chartData.map((entry, index) => {
                                const ratio = parseFloat(String(entry.loadFactor));
                                const getBaseColor = () => {
                                    if (entry.experts === 0 && entry.tickets > 0) return '#f87171'; // Red-400
                                    if (ratio < 3) return '#34d399'; // Emerald-400
                                    if (ratio <= 8) return '#818cf8'; // Indigo-400
                                    if (ratio <= 12) return '#fbbf24'; // Amber-400
                                    return '#f87171'; // Red-400
                                };
                                const baseColor = getBaseColor();
                                const isDimmed = activeHour !== null && activeHour !== entry.hour;

                                return (
                                    <Cell
                                        key={`cell-${index}`}
                                        fill={isDimmed ? `${baseColor}22` : baseColor}
                                        stroke={activeHour === entry.hour ? baseColor : 'none'}
                                        strokeWidth={2}
                                    />
                                );
                            })}
                        </Bar>
                        <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="experts"
                            name="Supply (Experts)"
                            stroke="#f472b6"
                            strokeWidth={3}
                            dot={(props: any) => {
                                const { cx, cy, payload } = props;
                                const isActive = payload.hour === activeHour;
                                return (
                                    <circle
                                        key={`dot-${payload.hour}`}
                                        cx={cx} cy={cy} r={isActive ? 6 : 4}
                                        fill={activeHour !== null && !isActive ? '#f472b633' : '#f472b6'}
                                        stroke={isActive ? '#fff' : 'none'}
                                        strokeWidth={2}
                                    />
                                );
                            }}
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="p-4 bg-indigo-50/5 dark:bg-indigo-900/10 rounded-2xl border border-indigo-500/10 text-center md:text-left">
                    <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1">Peak Demand</p>
                    <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{peakDemandHour.time}</p>
                    <p className="text-[10px] text-slate-500 mt-1">Highest volume hour.</p>
                </div>

                <div className="p-4 bg-pink-50/5 dark:bg-pink-900/10 rounded-2xl border border-pink-500/10 text-center md:text-left">
                    <p className="text-[10px] font-bold text-pink-400 uppercase tracking-widest mb-1">Avg. Workload</p>
                    <div className="flex items-baseline justify-center md:justify-start gap-2">
                        <p className="text-2xl font-black text-pink-600 dark:text-pink-400">
                            {(activeHours.reduce((acc, curr) => acc + parseFloat(String(curr.loadFactor)), 0) / (activeHours.length || 1)).toFixed(1)}
                        </p>
                        <p className="text-[10px] font-bold text-slate-500 italic">tickets/exp</p>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">Daily avg. pressure.</p>
                </div>

                <div className="p-4 bg-amber-50/5 dark:bg-amber-900/10 rounded-2xl border border-amber-500/10 text-center md:text-left">
                    <p className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-1">Bus. Coverage</p>
                    <p className="text-2xl font-black text-amber-600 dark:text-amber-400">{coveragePercent}%</p>
                    <p className="text-[10px] text-slate-500 mt-1">Service window: 07:30-22:30.</p>
                </div>

                <div className={`p-4 ${efficiency.bg} rounded-2xl border border-white/5 text-center md:text-left`}>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Efficiency Status</p>
                    <p className={`text-2xl font-black ${efficiency.color}`}>{efficiency.label}</p>
                    <p className="text-[10px] text-slate-500 mt-1">{efficiency.desc}</p>
                </div>
            </div>

            <div className="mt-6 p-3 bg-slate-50/5 dark:bg-slate-900/30 rounded-xl border border-dotted border-slate-300 dark:border-slate-700">
                <div className="flex flex-wrap items-center gap-6 justify-center text-[10px] font-bold uppercase tracking-wider">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="text-slate-400">Optimal (&lt;3 Ratio)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-indigo-400" />
                        <span className="text-slate-400">Balanced (3-8 Ratio)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-amber-400" />
                        <span className="text-slate-400">High Tension (8-12 Ratio)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-400" />
                        <span className="text-slate-400">Critical (&gt;12 or No Staff)</span>
                    </div>
                </div>
                <p className="text-center text-[9px] text-slate-500 mt-2 italic">
                    Ratio = Tickets per Expert. Staffing values are daily averages for the selected period.
                </p>
            </div>
        </Panel>
    );
}

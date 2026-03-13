import { useState } from 'react';
import { useT } from '../../i18n';
import { Panel, StatCard, Skeleton } from './DashboardHelpers';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import LLMSummary from './Stats/LLMSummary';
import TopicSummary from './Stats/TopicSummary';
import { trpc } from '../../utils/trpc';
import { motion } from 'framer-motion';

export default function AdminAIStats() {
  const t = useT();
  const [statsDept, setStatsDept] = useState('all');
  const [statsDateFrom, setStatsDateFrom] = useState('');
  const [statsDateTo, setStatsDateTo] = useState('');
  const [activePreset, setActivePreset] = useState<string | null>('30d');

  function applyPreset(key: string) {
    const now = new Date();
    const toStr = now.toISOString().slice(0, 10);
    let fromStr = toStr;
    if (key === '7d') {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      fromStr = d.toISOString().slice(0, 10);
    } else if (key === '30d') {
      const d = new Date(now);
      d.setDate(d.getDate() - 29);
      fromStr = d.toISOString().slice(0, 10);
    }
    setStatsDateFrom(fromStr);
    setStatsDateTo(toStr);
    setActivePreset(key);
  }

  const { data: stats, isLoading } = trpc.stats.getGlobalStats.useQuery(
    {
      dept: statsDept === 'all' ? undefined : statsDept,
      dateFrom: statsDateFrom || undefined,
      dateTo: statsDateTo || undefined,
    }
  );

  if (isLoading || !stats) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto p-4 animate-fade-in text-white">
        <Skeleton className="h-10 w-48 mb-8" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
        <Skeleton className="h-96 rounded-2xl w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in pb-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-solarized-base01 dark:text-white tracking-tight flex items-center gap-2">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-accent-400 to-rose-400">AI Intelligence Hub</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-500/10 border border-accent-500/20 text-accent-400 uppercase tracking-widest">Beta</span>
          </h2>
          <p className="text-sm text-solarized-base1 dark:text-gray-400 mt-1">Qualitative insights and sentiment analysis powered by Ollama</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 bg-solarized-base3/30 dark:bg-brand-800/30 p-2 rounded-2xl border border-white/5 backdrop-blur-xl self-start">
          <div className="flex gap-1">
            {['all', 'DSC', 'FOT'].map((d) => (
              <button
                key={d}
                onClick={() => setStatsDept(d)}
                className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all duration-300 ${
                  statsDept === d ? 'bg-accent-500 text-white shadow-lg shadow-accent-500/20' : 'text-solarized-base01 dark:text-gray-400 hover:bg-white/5'
                }`}
              >
                {d === 'all' ? 'All' : d}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* AI Top Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard 
          label="Global Sentiment" 
          value={stats.sentimentScore != null ? stats.sentimentScore.toFixed(2) : '—'} 
          color={stats.sentimentScore != null ? (stats.sentimentScore > 0.2 ? 'teal' : stats.sentimentScore < -0.2 ? 'red' : 'yellow') : 'gray'} 
          description="Average emotional tone of all messages (-1 to +1)"
        />
        <StatCard
          label="Resolution Quality"
          value={stats.reopenRate != null ? `${stats.reopenRate}%` : '—'}
          color="gray"
          invertTrend
          description="Percentage of tickets requiring a second look"
        />
        <StatCard
          label="SLA Risk"
          value={stats.p95ResponseMinutes != null ? `${stats.p95ResponseMinutes}m` : '—'}
          color="red"
          invertTrend
          description="p95 wait time (Outlier experience)"
        />
      </div>

      <div className="grid grid-cols-1 gap-6">
        <LLMSummary 
          periodType={activePreset || (statsDateFrom ? 'custom' : '30d')} 
          periodValue={activePreset ? activePreset : (statsDateFrom ? `${statsDateFrom}|${statsDateTo}` : '30d')} 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Sentiment Trend">
          <div className="h-[250px] w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats.dailyTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#93a1a122" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#93a1a1'}} />
                <YAxis domain={[-1, 1]} axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#93a1a1'}} />
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', backgroundColor: 'rgba(15, 23, 42, 0.9)', backdropFilter: 'blur(12px)', color: '#fff' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="sentiment" 
                  stroke="#10b981" 
                  strokeWidth={3} 
                  dot={{ r: 4, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }}
                  activeDot={{ r: 6, strokeWidth: 0 }}
                  name="Sentiment Score"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[10px] text-center text-solarized-base1 mt-2 uppercase font-bold tracking-widest">Historical emotional trend (-1 to +1)</p>
        </Panel>

        <Panel title="Sentiment by Department" className="bg-white/5 dark:bg-brand-900/20 backdrop-blur-2xl border-white/5">
          <div className="h-[250px] w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={Object.entries((stats as any).sentimentByDept || {}).map(([dept, data]: [string, any]) => ({ dept, score: data.avg || 0 }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#93a1a122" />
                <XAxis dataKey="dept" axisLine={false} tickLine={false} tick={{fill: '#93a1a1'}} />
                <YAxis domain={[-1, 1]} axisLine={false} tickLine={false} tick={{fill: '#93a1a1'}} />
                <Tooltip 
                  cursor={{ fill: 'transparent' }}
                  contentStyle={{ borderRadius: '16px', border: 'none', backgroundColor: 'rgba(15, 23, 42, 0.9)', backdropFilter: 'blur(12px)', color: '#fff' }}
                />
                <Bar 
                  dataKey="score" 
                  radius={[6, 6, 6, 6]} 
                  barSize={40}
                >
                  {Object.entries((stats as any).sentimentByDept || {}).map((entry: any, index) => (
                    <cell key={`cell-${index}`} fill={entry[1].avg > 0.2 ? '#10b981' : entry[1].avg < -0.2 ? '#f43f5e' : '#f59e0b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-between px-4 py-2 bg-white/5 rounded-xl mt-4">
            <div className="text-center">
              <p className="text-xs text-solarized-base1 font-bold">Negative</p>
              <div className="w-8 h-1 bg-rose-500 rounded-full mx-auto mt-1" />
            </div>
            <div className="text-center">
              <p className="text-xs text-solarized-base1 font-bold">Neutral</p>
              <div className="w-8 h-1 bg-amber-500 rounded-full mx-auto mt-1" />
            </div>
            <div className="text-center">
              <p className="text-xs text-solarized-base1 font-bold">Positive</p>
              <div className="w-8 h-1 bg-emerald-500 rounded-full mx-auto mt-1" />
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <TopicSummary daySummary={stats.daySummary} />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-8 rounded-3xl bg-gradient-to-br from-brand-500/10 via-accent-500/5 to-rose-500/10 border border-white/10 text-center"
      >
        <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-xl">
          <svg className="w-8 h-8 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-white mb-2">Predictive Staffing Insights</h3>
        <p className="text-sm text-gray-400 max-w-lg mx-auto">
          AI-driven forecasting is currently analyzing historical patterns to predict next week's peak hours and staffing requirements.
        </p>
      </motion.div>
    </div>
  );
}

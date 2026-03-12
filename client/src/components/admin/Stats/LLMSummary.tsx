import { useState, useEffect } from 'react';
import { Panel } from '../DashboardHelpers';
import { LLMSummaryData } from '../../../types';

interface LLMSummaryProps {
  periodType: string;
  periodValue: string;
}

export default function LLMSummary({ periodType, periodValue }: LLMSummaryProps) {
  const [summary, setSummary] = useState<LLMSummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!periodType || !periodValue) return;

    async function fetchSummary() {
      setLoading(true);
      setError(null);
      try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`/api/stats/summary?periodType=${periodType}&periodValue=${periodValue}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resp.ok) throw new Error('Failed to fetch AI summary');
        const data = await resp.json();
        setSummary(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchSummary();
  }, [periodType, periodValue]);

  if (loading) return (
    <Panel title="AI Perspective">
      <div className="animate-pulse space-y-4">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
        <div className="space-y-2">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded-xl"></div>
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded-xl"></div>
        </div>
      </div>
    </Panel>
  );

  if (error) return (
    <Panel title="AI Perspective">
      <p className="text-sm text-red-500 font-medium italic">Could not load AI summary: {error}</p>
    </Panel>
  );

  if (!summary) return null;

  const sentimentColors: Record<string, string> = {
    'Positive': 'text-green-500 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    'Neutral': 'text-blue-500 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    'Negative': 'text-red-500 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
    'Frustrated': 'text-orange-500 bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',
    'Mixed': 'text-purple-500 bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800'
  };

  const colorClass = sentimentColors[summary.sentiment] || 'text-gray-500 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700';

  return (
    <Panel title="AI Support Perspective" badge="LLM Insight">
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <div className={`px-4 py-2 rounded-2xl border text-sm font-black uppercase tracking-tighter ${colorClass}`}>
            {summary.sentiment}
          </div>
          <p className="text-sm text-slate-600 dark:text-gray-300 leading-relaxed font-medium">
            {summary.summary}
          </p>
        </div>

        {summary.questions && summary.questions.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              Top 3 Recurring Issues & Questions
              <div className="h-px flex-1 bg-slate-100 dark:bg-brand-800/50" />
            </h4>
            <div className="grid grid-cols-1 gap-2.5">
              {summary.questions.map((q: string, idx: number) => (
                <div key={idx} className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-brand-900/20 border border-slate-100 dark:border-brand-700/50 rounded-2xl hover:bg-white dark:hover:bg-brand-800/30 transition-colors duration-300">
                  <span className="text-brand-500 font-black text-xs shrink-0 mt-0.5">Q.</span>
                  <span className="text-xs font-semibold text-slate-700 dark:text-gray-200 italic leading-snug">{q}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <p className="text-[10px] text-slate-400 italic">
            * Analysis based on ticket transcripts for this period.
          </p>
          <span className="text-[9px] font-bold text-brand-400/50 tabular-nums">
            Refreshed: {new Date(summary.updatedAt).toLocaleTimeString()}
          </span>
        </div>
      </div>
    </Panel>
  );
}

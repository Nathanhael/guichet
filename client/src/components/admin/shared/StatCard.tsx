import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  color: 'red' | 'yellow' | 'green' | 'purple' | 'teal' | 'gray' | 'dark';
  prev?: string | number | null;
  invertTrend?: boolean;
  tooltip?: string;
}

export default function StatCard({ label, value, color, prev, invertTrend, tooltip }: StatCardProps) {
  const colors = {
    red: 'bg-gradient-to-br from-rose-50 to-rose-100/50 text-rose-600 border-rose-200/50 dark:from-rose-900/30 dark:to-transparent dark:text-rose-400 dark:border-rose-900/50',
    yellow: 'bg-gradient-to-br from-amber-50 to-amber-100/50 text-amber-700 border-amber-200/50 dark:from-amber-900/30 dark:to-transparent dark:text-amber-400 dark:border-amber-900/50',
    green: 'bg-gradient-to-br from-emerald-50 to-emerald-100/50 text-emerald-700 border-emerald-200/50 dark:from-emerald-900/30 dark:to-transparent dark:text-emerald-400 dark:border-emerald-900/50',
    purple: 'bg-gradient-to-br from-purple-50 to-purple-100/50 text-purple-700 border-purple-200/50 dark:from-purple-900/30 dark:to-transparent dark:text-purple-400 dark:border-purple-900/50',
    teal: 'bg-gradient-to-br from-teal-50 to-teal-100/50 text-teal-700 border-teal-200/50 dark:from-teal-900/30 dark:to-transparent dark:text-teal-400 dark:border-teal-900/50',
    gray: 'bg-gradient-to-br from-slate-50 to-slate-100/50 text-slate-600 border-slate-200/50 dark:from-slate-800/50 dark:to-transparent dark:text-slate-300 dark:border-slate-700/50',
    dark: 'bg-gradient-to-br from-slate-800 to-slate-900 text-white border-slate-700/50 shadow-md',
  };

  // Compute trend arrow
  let trendEl = null;
  if (prev !== undefined && prev !== null) {
    const current = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.-]/g, ''));
    const prevNum = typeof prev === 'number' ? prev : parseFloat(String(prev).replace(/[^0-9.-]/g, ''));
    if (!isNaN(current) && !isNaN(prevNum) && prevNum !== 0) {
      const delta = current - prevNum;
      const pct = Math.round((delta / prevNum) * 100);
      if (delta !== 0) {
        const isUp = delta > 0;
        const isGood = invertTrend ? !isUp : isUp;
        trendEl = (
          <span className={`inline-flex items-center gap-0.5 text-xs font-bold mt-1 ${isGood ? 'text-emerald-500' : 'text-rose-500'}`}>
            {isUp ? '\u25B2' : '\u25BC'} {Math.abs(pct)}%
          </span>
        );
      }
    }
  }

  return (
    <div className={`group relative rounded-xl border p-5 shadow-sm hover:-translate-y-1 hover:shadow-md transition-all duration-300 ${colors[color] || colors.gray}`}>
      <div className="flex items-center gap-1.5 opacity-80">
        <p className="text-sm font-medium tracking-tight whitespace-nowrap">{label}</p>
        {tooltip && (
          <div className="cursor-help text-xs opacity-50 hover:opacity-100">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        )}
      </div>
      <p className="text-3xl font-bold mt-1.5">{value}</p>
      {trendEl}

      {tooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-900 text-[10px] text-white rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-xl border border-white/10 text-center leading-tight">
          {tooltip}
        </div>
      )}
    </div>
  );
}

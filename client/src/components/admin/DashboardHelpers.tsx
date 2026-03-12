import React from 'react';

export function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          xmlns="http://www.w3.org/2000/svg"
          className={`h-3.5 w-3.5 ${n <= value ? 'text-amber-400' : 'text-solarized-base2 dark:text-gray-600'}`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </span>
  );
}

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-card p-5 shadow-soft border-solarized-base2 dark:border-brand-700/50 hover:shadow-lg transition-shadow duration-300">
      <p className="text-sm font-semibold text-solarized-base01 dark:text-gray-300 mb-4 tracking-wide uppercase">{title}</p>
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  color: 'red' | 'yellow' | 'green' | 'purple' | 'teal' | 'gray' | 'dark';
  prev?: string | number | null;
  invertTrend?: boolean;
}

export function StatCard({ label, value, color, prev, invertTrend }: StatCardProps) {
  const colors = {
    red: 'bg-gradient-to-br from-rose-50 to-rose-100/50 text-rose-600 border-rose-200/50 dark:from-rose-900/30 dark:to-transparent dark:text-rose-400 dark:border-rose-900/50',
    yellow: 'bg-gradient-to-br from-amber-50 to-amber-100/50 text-amber-700 border-amber-200/50 dark:from-amber-900/30 dark:to-transparent dark:text-amber-400 dark:border-amber-900/50',
    green: 'bg-gradient-to-br from-emerald-50 to-emerald-100/50 text-emerald-700 border-emerald-200/50 dark:from-emerald-900/30 dark:to-transparent dark:text-emerald-400 dark:border-emerald-900/50',
    purple: 'bg-gradient-to-br from-purple-50 to-purple-100/50 text-purple-700 border-purple-200/50 dark:from-purple-900/30 dark:to-transparent dark:text-purple-400 dark:border-purple-900/50',
    teal: 'bg-gradient-to-br from-teal-50 to-teal-100/50 text-teal-700 border-teal-200/50 dark:from-teal-900/30 dark:to-transparent dark:text-teal-400 dark:border-teal-900/50',
    gray: 'bg-gradient-to-br from-solarized-base3 to-solarized-base2/50 text-solarized-base1 border-solarized-base2/50 dark:from-slate-800/50 dark:to-transparent dark:text-slate-300 dark:border-slate-700/50',
    dark: 'bg-gradient-to-br from-solarized-base03 to-solarized-base02 text-white border-solarized-base03/50 shadow-md',
  };

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
    <div className={`rounded-xl border p-5 shadow-sm hover:-translate-y-1 hover:shadow-md transition-all duration-300 ${colors[color] || colors.gray}`}>
      <p className="text-sm font-medium opacity-80 tracking-tight">{label}</p>
      <p className="text-3xl font-bold mt-1.5">{value}</p>
      {trendEl}
    </div>
  );
}

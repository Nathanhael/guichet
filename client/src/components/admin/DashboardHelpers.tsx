import React from 'react';

export function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          xmlns="http://www.w3.org/2000/svg"
          className={`h-3.5 w-3.5 transition-colors duration-500 ${n <= value ? 'text-amber-400 drop-shadow-[0_0_3px_rgba(251,191,36,0.4)]' : 'text-solarized-base2 dark:text-gray-600'}`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </span>
  );
}

export function Panel({ title, badge, className = '', children }: { title: string; badge?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`glass-card p-6 shadow-soft hover:shadow-2xl hover:translate-y-[-2px] ${className}`}>
      <div className="flex items-center justify-between mb-5">
        <p className="text-xs font-bold text-solarized-base1 dark:text-gray-400 tracking-widest uppercase">{title}</p>
        {badge && (
          <span className="px-2.5 py-1 rounded-lg bg-brand-500/10 text-brand-500 text-[10px] font-black uppercase tracking-tighter border border-brand-500/20 shadow-sm">
            {badge}
          </span>
        )}
      </div>
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
    red: 'bg-gradient-to-br from-rose-50/50 to-rose-100/30 text-rose-600 border-rose-200/40 dark:from-rose-900/20 dark:to-transparent dark:text-rose-400 dark:border-rose-900/30',
    yellow: 'bg-gradient-to-br from-amber-50/50 to-amber-100/30 text-amber-700 border-amber-200/40 dark:from-amber-900/20 dark:to-transparent dark:text-amber-400 dark:border-amber-900/30',
    green: 'bg-gradient-to-br from-emerald-50/50 to-emerald-100/30 text-emerald-700 border-emerald-200/40 dark:from-emerald-900/20 dark:to-transparent dark:text-emerald-400 dark:border-emerald-900/30',
    purple: 'bg-gradient-to-br from-purple-50/50 to-purple-100/30 text-purple-700 border-purple-200/40 dark:from-purple-900/20 dark:to-transparent dark:text-purple-400 dark:border-purple-900/30',
    teal: 'bg-gradient-to-br from-teal-50/50 to-teal-100/30 text-teal-700 border-teal-200/40 dark:from-teal-900/20 dark:to-transparent dark:text-teal-400 dark:border-teal-900/30',
    gray: 'bg-gradient-to-br from-solarized-base3/50 to-solarized-base2/30 text-solarized-base1 border-solarized-base2/40 dark:from-slate-800/30 dark:to-transparent dark:text-slate-300 dark:border-slate-700/30',
    dark: 'bg-gradient-to-br from-solarized-base03 to-solarized-base02 text-white border-solarized-base03/50 shadow-lg',
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
          <span className={`inline-flex items-center gap-1 text-[10px] font-black mt-2 px-2 py-0.5 rounded-full border ${isGood ? 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-600 bg-rose-500/10 border-rose-500/20'}`}>
            {isUp ? '↑' : '↓'} {Math.abs(pct)}%
          </span>
        );
      }
    }
  }

  return (
    <div className={`rounded-2xl border p-5 shadow-sm hover:-translate-y-1.5 hover:shadow-xl transition-all duration-500 backdrop-blur-sm ${colors[color] || colors.gray}`}>
      <p className="text-[10px] font-bold uppercase tracking-widest opacity-70 leading-none">{label}</p>
      <p className="text-3xl font-black mt-2 tracking-tighter leading-none">{value}</p>
      {trendEl}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`glass-skeleton ${className}`} />;
}

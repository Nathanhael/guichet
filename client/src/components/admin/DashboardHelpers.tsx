import React from 'react';

export function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          xmlns="http://www.w3.org/2000/svg"
          className={`h-3.5 w-3.5 ${n <= value ? 'text-black dark:text-white' : 'text-black/20 dark:text-white/20'}`}
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
    <div className={`border-2 border-black dark:border-white p-6 ${className}`}>
      <div className="flex items-center justify-between mb-5">
        <p className="text-xs font-bold text-black dark:text-white opacity-60 tracking-widest uppercase">{title}</p>
        {badge && (
          <span className="px-2.5 py-1 bg-black/5 dark:bg-white/5 text-black dark:text-white text-[10px] font-black uppercase tracking-tighter border border-black dark:border-white">
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

export function StatCard({ label, value, prev, invertTrend }: StatCardProps) {
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
          <span className={`inline-flex items-center gap-1 text-[10px] font-black mt-2 px-2 py-0.5 border ${isGood ? 'text-black dark:text-white border-black dark:border-white' : 'text-black dark:text-white opacity-60 border-black/40 dark:border-white/40'}`}>
            {isUp ? '↑' : '↓'} {Math.abs(pct)}%
          </span>
        );
      }
    }
  }

  return (
    <div className="border-2 border-black dark:border-white p-5 bg-black/5 dark:bg-white/5">
      <p className="text-[10px] font-bold uppercase tracking-widest opacity-70 leading-none">{label}</p>
      <p className="text-3xl font-black mt-2 tracking-tighter leading-none">{value}</p>
      {trendEl}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-black/10 dark:bg-white/10 ${className}`} />;
}

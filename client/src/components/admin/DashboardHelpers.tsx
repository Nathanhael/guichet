import React from 'react';

export function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          xmlns="http://www.w3.org/2000/svg"
          className={`h-3.5 w-3.5 ${n <= value ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-muted)] opacity-30'}`}
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
    <div className={`rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)] p-5 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">{title}</p>
        {badge && (
          <span className="px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] text-[11px] font-medium text-[var(--color-ink-soft)]">
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
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-medium mt-1.5 px-2 py-0.5 rounded-[var(--radius-pill)] ${
              isGood
                ? 'bg-[color-mix(in_srgb,var(--color-ok)_14%,transparent)] text-[var(--color-ok)]'
                : 'bg-[var(--color-urgent-soft)] text-[var(--color-urgent)]'
            }`}
          >
            {isUp ? '↑' : '↓'} {Math.abs(pct)}%
          </span>
        );
      }
    }
  }

  return (
    <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)] p-5 flex flex-col justify-between">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] leading-none">{label}</p>
      <p className="text-[28px] font-semibold mt-2 tracking-tight leading-none text-[var(--color-ink)] tabular-nums">{value}</p>
      {trendEl}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] animate-pulse ${className}`} />;
}

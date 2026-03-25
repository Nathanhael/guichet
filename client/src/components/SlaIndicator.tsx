import { useState, useEffect } from 'react';

interface SlaIndicatorProps {
  dueAt: string;
  breached?: boolean;
  compact?: boolean;
  totalMs?: number; // total SLA duration for percentage-based color
}

function getTimeRemaining(dueAt: string): { totalMs: number; minutes: number; seconds: number } {
  const now = Date.now();
  const due = new Date(dueAt).getTime();
  const totalMs = due - now;
  const absTotalMs = Math.abs(totalMs);
  const minutes = Math.floor(absTotalMs / 60000);
  const seconds = Math.floor((absTotalMs % 60000) / 1000);
  return { totalMs, minutes, seconds };
}

function getSlaColor(remainingMs: number, breached?: boolean, slaTotalMs?: number): 'green' | 'yellow' | 'red' {
  if (breached || remainingMs <= 0) return 'red';
  if (slaTotalMs && slaTotalMs > 0) {
    const pct = remainingMs / slaTotalMs;
    if (pct < 0.1) return 'red';
    if (pct < 0.25) return 'yellow';
    return 'green';
  }
  // Fallback to absolute thresholds
  if (remainingMs < 2 * 60 * 1000) return 'red';
  if (remainingMs < 5 * 60 * 1000) return 'yellow';
  return 'green';
}

const COLOR_CLASSES = {
  green: 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700',
  yellow: 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700',
  red: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700',
};

const DOT_CLASSES = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-500',
  red: 'bg-red-500',
};

/**
 * SLA countdown indicator.
 * - Full mode (compact=false): shows "SLA: Respond within X min"
 * - Compact mode (compact=true): shows just a colored dot
 */
export default function SlaIndicator({ dueAt, breached, compact, totalMs: slaTotalMs }: SlaIndicatorProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Force re-render with now dependency
  void now;

  const { totalMs, minutes, seconds } = getTimeRemaining(dueAt);
  const color = getSlaColor(totalMs, breached, slaTotalMs);

  if (compact) {
    return (
      <span
        title={totalMs <= 0 ? `SLA breached (${minutes}m overdue)` : `SLA: ${minutes}m ${seconds}s remaining`}
        className={`w-2 h-2 rounded-full shrink-0 inline-block ${DOT_CLASSES[color]} ${color === 'red' ? 'animate-pulse' : ''}`}
      />
    );
  }

  const label = totalMs <= 0
    ? `SLA: ${minutes}m overdue`
    : `SLA: ${minutes}m ${seconds < 10 ? '0' : ''}${seconds}s`;

  return (
    <span className={`text-[9px] font-black px-2 py-0.5 rounded-md uppercase tracking-widest border shadow-sm ${COLOR_CLASSES[color]} ${color === 'red' ? 'animate-pulse' : ''}`}>
      {label}
    </span>
  );
}

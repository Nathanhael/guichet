import React from 'react';

interface PanelProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  badge?: string;
}

export default function Panel({ title, children, className = '', badge }: PanelProps) {
  return (
    <div className={`glass-card p-5 shadow-soft border-white/40 dark:border-brand-700/50 hover:shadow-lg transition-shadow duration-300 ${className}`}>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm font-semibold text-slate-700 dark:text-gray-300 tracking-wide uppercase">{title}</p>
        {badge && (
          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-500/20 uppercase tracking-widest">
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

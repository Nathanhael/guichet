import React from 'react';

export default function Panel({ title, children, className = '' }) {
    return (
        <div className={`glass-card p-5 shadow-soft border-white/40 dark:border-brand-700/50 hover:shadow-lg transition-shadow duration-300 ${className}`}>
            <p className="text-sm font-semibold text-slate-700 dark:text-gray-300 mb-4 tracking-wide uppercase">{title}</p>
            {children}
        </div>
    );
}

import React, { useState, useRef, useEffect } from 'react';
import useStore from '../store/useStore';
import { useT } from '../i18n';

export default function CannedResponsePicker({ onSelect }) {
    const { cannedResponses } = useStore();
    const t = useT();
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const ref = useRef(null);

    const filtered = cannedResponses.filter(r =>
        r.shortcut.toLowerCase().includes(search.toLowerCase()) ||
        r.text.toLowerCase().includes(search.toLowerCase())
    );

    useEffect(() => {
        function onOutsideClick(e) {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        }
        document.addEventListener('mousedown', onOutsideClick);
        return () => document.removeEventListener('mousedown', onOutsideClick);
    }, []);

    if (cannedResponses.length === 0) return null;

    return (
        <div ref={ref} className="relative inline-block">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                title="Canned Responses"
                className={`p-1.5 rounded-lg transition-colors shrink-0 ${open
                    ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400'
                    : 'text-gray-500 dark:text-gray-400 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-brand-700'
                    }`}
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
            </button>

            {open && (
                <div className="absolute bottom-full left-0 mb-2 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden z-50">
                    <div className="p-2 border-b border-gray-100 dark:border-gray-700">
                        <input
                            type="text"
                            autoFocus
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search /shortcut or text..."
                            className="w-full text-xs px-2.5 py-1.5 rounded bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-800 dark:text-gray-200"
                        />
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                        {filtered.length === 0 ? (
                            <div className="p-4 text-center text-xs text-gray-400">No matching responses.</div>
                        ) : (
                            <ul className="divide-y divide-gray-50 dark:divide-gray-700">
                                {filtered.map(r => (
                                    <li key={r.id}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onSelect(r.text);
                                                setOpen(false);
                                            }}
                                            className="w-full text-left p-2.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors group"
                                        >
                                            <div className="font-mono text-[10px] text-blue-600 dark:text-blue-400 mb-0.5">{r.shortcut}</div>
                                            <div className="text-xs text-gray-700 dark:text-gray-300 line-clamp-2 leading-relaxed">{r.text}</div>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

import { useState, useMemo, useRef, useEffect } from 'react';
import { getTimezones, detectTimezone, groupByRegion, REGION_ORDER } from '../utils/timezones';

interface TimezonePickerProps {
  value: string;
  onChange: (tz: string) => void;
  label?: string;
  className?: string;
}

export default function TimezonePicker({ value, onChange, label, className }: TimezonePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allTimezones = useMemo(() => getTimezones(), []);
  const detectedTz = useMemo(() => detectTimezone(), []);

  const filtered = useMemo(() => {
    if (!search.trim()) return allTimezones;
    const q = search.toLowerCase().replace(/\s+/g, '');
    return allTimezones.filter(
      (tz) =>
        tz.id.toLowerCase().replace(/[_/]/g, '').includes(q) ||
        tz.label.toLowerCase().replace(/\s+/g, '').includes(q)
    );
  }, [search, allTimezones]);

  const grouped = useMemo(() => groupByRegion(filtered), [filtered]);

  const currentEntry = allTimezones.find((tz) => tz.id === value);
  const displayValue = currentEntry?.label || value;

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Focus input on open
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  function select(tzId: string) {
    onChange(tzId);
    setOpen(false);
    setSearch('');
  }

  return (
    <div ref={containerRef} className={`relative ${className || ''}`}>
      {label && <label className="mono-label mb-2 block">{label}</label>}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="input-field w-full text-left flex items-center justify-between gap-2"
      >
        <span className="truncate text-xs font-mono">{displayValue}</span>
        <svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[var(--color-bg-surface)] border-2 border-[var(--color-border)] max-h-[360px] flex flex-col">
          {/* Search */}
          <div className="p-2 border-b border-[var(--color-border)]">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search timezones..."
              className="input-field w-full text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setOpen(false); setSearch(''); }
              }}
            />
          </div>

          {/* Detected timezone shortcut */}
          {!search && detectedTz && detectedTz !== value && (
            <button
              type="button"
              onClick={() => select(detectedTz)}
              className="w-full text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wide border-b border-[var(--color-border)] bg-[var(--color-accent-blue)]/5 hover:bg-[var(--color-accent-blue)]/10"
            >
              <span className="text-[var(--color-accent-blue)]">Detected:</span>{' '}
              <span className="font-mono">{detectedTz}</span>
            </button>
          )}

          {/* Grouped list */}
          <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
                No timezones match "{search}"
              </div>
            ) : (
              [...grouped.entries()]
                .sort((a, b) => {
                  const ai = REGION_ORDER.indexOf(a[0]);
                  const bi = REGION_ORDER.indexOf(b[0]);
                  return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
                })
                .map(([region, entries]) => (
                  <div key={region}>
                    <div className="px-3 py-1.5 text-[8px] font-bold uppercase tracking-widest text-[var(--color-text-muted)] bg-[var(--color-bg-elevated)] sticky top-0">
                      {region}
                    </div>
                    {entries.map((tz) => (
                      <button
                        key={tz.id}
                        type="button"
                        onClick={() => select(tz.id)}
                        className={`w-full text-left px-3 py-1.5 text-[11px] font-mono hover:bg-[var(--color-accent-blue)] hover:text-white ${
                          tz.id === value ? 'bg-[var(--color-accent-blue)]/10 font-bold' : ''
                        }`}
                      >
                        {tz.label}
                      </button>
                    ))}
                  </div>
                ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

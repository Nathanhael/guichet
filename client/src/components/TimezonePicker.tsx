import { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { getTimezones, detectTimezone, groupByRegion, REGION_ORDER } from '../utils/timezones';
import SectionLabel from './ui/SectionLabel';

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

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

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
      {label && <SectionLabel className="mb-2 block">{label}</SectionLabel>}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 text-left text-[13px] text-[var(--color-ink)] hover:bg-[var(--color-hover)] flex items-center justify-between gap-2 transition-colors"
      >
        <span className="truncate">{displayValue}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[var(--color-ink-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)] max-h-[360px] flex flex-col overflow-hidden">
          <div className="p-2 border-b border-[var(--color-border)]">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search timezones…"
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-1.5 text-[12px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus:border-[var(--color-accent)]"
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setOpen(false); setSearch(''); }
              }}
            />
          </div>

          {!search && detectedTz && detectedTz !== value && (
            <button
              type="button"
              onClick={() => select(detectedTz)}
              className="w-full text-left px-3 py-2 text-[12px] border-b border-[var(--color-border)] bg-[var(--color-accent-soft)] hover:bg-[var(--color-accent-soft)] text-[var(--color-accent)] transition-colors"
            >
              <span className="font-semibold">Detected:</span>{' '}
              <span className="font-mono">{detectedTz}</span>
            </button>
          )}

          <div ref={listRef} className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-[var(--color-ink-muted)]">
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
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--color-ink-muted)] bg-[var(--color-bg-elevated)] sticky top-0">
                      {region}
                    </div>
                    {entries.map((tz) => (
                      <button
                        key={tz.id}
                        type="button"
                        onClick={() => select(tz.id)}
                        className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors ${
                          tz.id === value
                            ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-semibold'
                            : 'text-[var(--color-ink)] hover:bg-[var(--color-hover)]'
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

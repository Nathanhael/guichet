import { useRef, useEffect } from 'react';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import { useT } from '../../i18n';

interface SearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  currentMatchIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export default function SearchBar({ query, onQueryChange, matchCount, currentMatchIndex, onNext, onPrev, onClose }: SearchBarProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); onPrev(); }
    else if (e.key === 'Enter') { e.preventDefault(); onNext(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); onPrev(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); onNext(); }
  }

  const hasQuery = query.trim().length > 0;
  const hasMatches = matchCount > 0;

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-elevated)] border-b border-[var(--color-border)] animate-[fade-in_150ms_ease-out]">
      <Search size={14} strokeWidth={2} className="text-[var(--color-ink-muted)] shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('search_in_conversation') || 'Search in conversation'}
        className="flex-1 rounded-[var(--radius-btn)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] px-2.5 py-1 text-[12px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] outline-none focus:border-[var(--color-accent)]"
        aria-label={t('search_in_conversation') || 'Search in conversation'}
      />
      {hasQuery && (
        <span className="text-[11px] font-medium text-[var(--color-ink-soft)] tabular-nums shrink-0 min-w-[60px] text-right">
          {hasMatches ? `${currentMatchIndex + 1} / ${matchCount}` : (t('no_results') || 'No results')}
        </span>
      )}
      <button onClick={onPrev} disabled={!hasMatches} className="p-1 rounded-[var(--radius-btn)] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:bg-[var(--color-hover)] disabled:opacity-30 disabled:hover:bg-transparent transition-colors" aria-label="Previous match">
        <ChevronUp size={14} strokeWidth={2} />
      </button>
      <button onClick={onNext} disabled={!hasMatches} className="p-1 rounded-[var(--radius-btn)] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:bg-[var(--color-hover)] disabled:opacity-30 disabled:hover:bg-transparent transition-colors" aria-label="Next match">
        <ChevronDown size={14} strokeWidth={2} />
      </button>
      <button onClick={onClose} className="p-1 rounded-[var(--radius-btn)] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:bg-[var(--color-hover)] transition-colors" aria-label="Close search">
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  );
}

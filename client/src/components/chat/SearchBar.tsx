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
    <div className="flex items-center gap-2 px-4 py-2 bg-bg-elevated border-b border-border animate-fade-in">
      <Search size={14} className="text-text-secondary shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('search_in_conversation') || 'Search in conversation'}
        className="flex-1 bg-bg-surface border border-border px-2 py-1 font-mono text-[11px] text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
        aria-label={t('search_in_conversation') || 'Search in conversation'}
      />
      {hasQuery && (
        <span className="font-mono text-[10px] text-text-secondary shrink-0 min-w-[60px] text-right">
          {hasMatches ? `${currentMatchIndex + 1} / ${matchCount}` : (t('no_results') || 'No results')}
        </span>
      )}
      <button onClick={onPrev} disabled={!hasMatches} className="p-1 text-text-secondary hover:text-text-primary disabled:opacity-30" aria-label="Previous match">
        <ChevronUp size={14} />
      </button>
      <button onClick={onNext} disabled={!hasMatches} className="p-1 text-text-secondary hover:text-text-primary disabled:opacity-30" aria-label="Next match">
        <ChevronDown size={14} />
      </button>
      <button onClick={onClose} className="p-1 text-text-secondary hover:text-text-primary" aria-label="Close search">
        <X size={14} />
      </button>
    </div>
  );
}

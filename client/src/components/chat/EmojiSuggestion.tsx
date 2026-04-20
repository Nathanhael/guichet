import { useState, useEffect, useRef } from 'react';
import { searchEmoji } from '../../utils/emojiData';

interface EmojiSuggestionProps {
  query: string;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export default function EmojiSuggestion({ query, onSelect, onClose }: EmojiSuggestionProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const results = searchEmoji(query);

  useEffect(() => { setActiveIndex(0); }, [query]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (results[activeIndex]) onSelect(results[activeIndex].emoji);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [results, activeIndex, onSelect, onClose]);

  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (results.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 mb-1 w-60 max-h-48 overflow-y-auto rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)] z-50 p-1"
    >
      {results.map((entry, i) => (
        <button
          key={entry.name}
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onSelect(entry.emoji); }}
          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left rounded-[var(--radius-btn)] transition-colors ${
            i === activeIndex
              ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
              : 'text-[var(--color-ink)] hover:bg-[var(--color-hover)]'
          }`}
        >
          <span className="text-base">{entry.emoji}</span>
          <span className="text-[12px] font-medium truncate">:{entry.name}</span>
        </button>
      ))}
    </div>
  );
}

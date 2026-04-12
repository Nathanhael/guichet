import { useState, useEffect, useRef } from 'react';
import { searchEmoji } from '../../utils/emojiData';

interface EmojiSuggestionProps {
  query: string;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

/**
 * Inline emoji suggestion panel — triggered by `:query` in the compose editor.
 * Filters emoji by name/keywords, keyboard-navigable (Up/Down/Enter/Escape).
 */
export default function EmojiSuggestion({ query, onSelect, onClose }: EmojiSuggestionProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const results = searchEmoji(query);

  // Reset selection when results change
  useEffect(() => { setActiveIndex(0); }, [query]);

  // Keyboard navigation — captured at the document level so it works
  // even while focus is inside the Tiptap editor.
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

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (results.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 mb-1 w-56 max-h-48 overflow-y-auto bg-bg-surface border-2 border-border-heavy z-50"
    >
      {results.map((entry, i) => (
        <button
          key={entry.name}
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onSelect(entry.emoji); }}
          className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left ${
            i === activeIndex
              ? 'bg-accent-blue text-[var(--color-btn-text-inverse)]'
              : 'text-text-primary hover:bg-bg-elevated'
          }`}
        >
          <span className="text-base">{entry.emoji}</span>
          <span className="font-mono text-[10px] font-bold truncate">:{entry.name}</span>
        </button>
      ))}
    </div>
  );
}

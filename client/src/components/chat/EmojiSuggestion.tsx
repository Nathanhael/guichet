import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { searchEmoji } from '../../utils/emojiData';

interface EmojiSuggestionProps {
  query: string;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const POPUP_WIDTH = 240;

export default function EmojiSuggestion({ query, onSelect, onClose }: EmojiSuggestionProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [popupPos, setPopupPos] = useState<{ bottom: number; left: number } | null>(null);
  const results = searchEmoji(query);

  // Reset selection index when the query changes; activeIndex is independently
  // navigated by arrow keys so can't be purely derived.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIndex(0);
  }, [query]);

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

  // Portal popup: the compose wrapper has overflow-hidden, so anchor a
  // 0-height div in-place and render the popup into document.body with
  // fixed positioning to escape the clip.
  useLayoutEffect(() => {
    function compute() {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const GAP = 4;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPopupPos({
        bottom: window.innerHeight - r.top + GAP,
        left: r.left,
      });
    }
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, []);

  // Always mount the anchor so useLayoutEffect can measure on first commit.
  // Gating the popup here (not the whole component) keeps popupPos live.
  const showPopup = results.length > 0;

  const style = popupPos
    ? { position: 'fixed' as const, bottom: popupPos.bottom, left: popupPos.left, width: POPUP_WIDTH }
    : { display: 'none' as const };

  const popup = (
    <div
      ref={listRef}
      style={style}
      className="z-[60] max-h-48 overflow-y-auto rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)] p-1"
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

  return (
    <>
      <div ref={anchorRef} className="absolute inset-x-0 top-0 h-0" aria-hidden />
      {showPopup && typeof document !== 'undefined' && createPortal(popup, document.body)}
    </>
  );
}

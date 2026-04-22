import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { trpc } from '../utils/trpc';
import { useT } from '../i18n';
import useStore from '../store/useStore';
import SectionLabel from './ui/SectionLabel';

interface CannedResponse {
  id: string;
  title: string;
  body: string;
  shortcut: string | null;
  dept: string | null;
}

interface CannedResponsePickerProps {
  /** Current text in the input — used to detect "/" trigger */
  inputText: string;
  /** Department of the current ticket */
  dept?: string;
  /** Ticket ID for {{ticketId}} variable expansion */
  ticketId?: string;
  /** Called when a response is selected */
  onSelect: (body: string) => void;
  /** Called to close the picker */
  onClose: () => void;
}

/**
 * Slash-command popup for canned responses.
 * Shows when user types "/" at the start of input.
 * Filters by search query after the slash.
 */
export default function CannedResponsePicker({ inputText, dept, ticketId, onSelect, onClose }: CannedResponsePickerProps) {
  const t = useT();
  const user = useStore((s) => s.user);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [popupPos, setPopupPos] = useState<{ bottom: number; left: number; width: number } | null>(null);
  const onCloseRef = useRef(onClose);
  // Pin latest onClose to a ref so the document listener below doesn't need
  // to re-bind on every render (would defeat the point of the useEffect with []).
  // eslint-disable-next-line react-hooks/refs
  onCloseRef.current = onClose;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      onCloseRef.current();
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Portaled popup: anchor to the wrapper's rect (sits inside the compose
  // area's overflow-hidden container). Render into document.body with fixed
  // positioning so the popup escapes the clip.
  useLayoutEffect(() => {
    function compute() {
      const el = wrapperRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const GAP = 4;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPopupPos({
        bottom: window.innerHeight - r.top + GAP,
        left: r.left,
        width: r.width,
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

  const { data: responses } = trpc.cannedResponse.list.useQuery(
    { dept },
    { enabled: !!user }
  );

  const query = inputText.startsWith('/') ? inputText.slice(1).toLowerCase() : '';

  const filtered = (responses || []).filter((r: CannedResponse) => {
    if (!query) return true;
    return (
      r.title.toLowerCase().includes(query) ||
      r.body.toLowerCase().includes(query) ||
      (r.shortcut && r.shortcut.toLowerCase().includes(query))
    );
  });

  // Reset selection when the filter query changes. Can't be derived state
  // because the user also navigates via arrow keys, so selectedIndex owns
  // its identity across renders.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIndex(0);
  }, [query]);

  const expandVariables = useCallback((body: string): string => {
    const state = useStore.getState();
    return body
      .replace(/\{\{agentName\}\}/g, state.user?.name || '')
      .replace(/\{\{supportName\}\}/g, state.user?.name || '')
      .replace(/\{\{ticketId\}\}/g, ticketId || '');
  }, [ticketId]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const target = wrapper.closest('form');
    if (!target) return;
    function handleKeyDown(e: Event) {
      const ke = e as KeyboardEvent;
      if (ke.key === 'ArrowDown') {
        ke.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (ke.key === 'ArrowUp') {
        ke.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (ke.key === 'Enter' && filtered.length > 0) {
        ke.preventDefault();
        onSelect(expandVariables(filtered[selectedIndex].body));
      } else if (ke.key === 'Escape') {
        onClose();
      }
    }
    target.addEventListener('keydown', handleKeyDown, true);
    return () => target.removeEventListener('keydown', handleKeyDown, true);
  }, [filtered, selectedIndex, onSelect, onClose, expandVariables]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Always mount the anchor so useLayoutEffect can measure on first commit
  // (tRPC responses arrive async — if we early-return before the wrapper
  // mounts, popupPos never gets computed and the popup stays hidden).
  const showPopup = filtered.length > 0 || !!query;

  const style = popupPos
    ? { position: 'fixed' as const, bottom: popupPos.bottom, left: popupPos.left, width: popupPos.width }
    : { display: 'none' as const };

  const popup = filtered.length === 0 ? (
    <div
      ref={popupRef}
      style={style}
      className="z-[60] rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)] p-4"
    >
      <p className="text-[12px] text-[var(--color-ink-muted)] italic">{t('no_canned_responses') || 'No matching responses'}</p>
    </div>
  ) : (
    <div
      ref={(node) => {
        popupRef.current = node;
        listRef.current = node;
      }}
      style={style}
      className="z-[60] rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)] max-h-64 overflow-y-auto"
    >
      <div className="px-3 py-2 border-b border-[var(--color-border)]">
        <SectionLabel>{t('canned_responses') || 'Quick replies'}</SectionLabel>
      </div>
      {filtered.map((r: CannedResponse, idx: number) => (
        <button
          key={r.id}
          onClick={() => onSelect(expandVariables(r.body))}
          onMouseEnter={() => setSelectedIndex(idx)}
          className={`w-full text-left px-4 py-2.5 flex flex-col gap-0.5 transition-colors ${
            idx === selectedIndex
              ? 'bg-[var(--color-accent-soft)]'
              : 'hover:bg-[var(--color-hover)]'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold text-[var(--color-ink)]">{r.title}</span>
            {r.shortcut && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] text-[var(--color-ink-muted)]">
                /{r.shortcut}
              </span>
            )}
            {r.dept && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] text-[var(--color-ink-muted)] font-medium">
                {r.dept}
              </span>
            )}
          </div>
          <span className="text-[11px] text-[var(--color-ink-soft)] truncate">{r.body}</span>
        </button>
      ))}
    </div>
  );

  return (
    <>
      <div ref={wrapperRef} className="absolute inset-x-0 top-0 h-0" aria-hidden />
      {showPopup && typeof document !== 'undefined' && createPortal(popup, document.body)}
    </>
  );
}

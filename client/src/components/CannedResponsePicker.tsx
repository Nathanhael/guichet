import { useState, useEffect, useRef } from 'react';
import { trpc } from '../utils/trpc';
import { useT } from '../i18n';
import useStore from '../store/useStore';

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
export default function CannedResponsePicker({ inputText, dept, onSelect, onClose }: CannedResponsePickerProps) {
  const t = useT();
  const user = useStore((s) => s.user);
  const listRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const { data: responses } = trpc.cannedResponse.list.useQuery(
    { dept },
    { enabled: !!user }
  );

  // Extract search query after "/"
  const query = inputText.startsWith('/') ? inputText.slice(1).toLowerCase() : '';

  // Filter responses by query
  const filtered = (responses || []).filter((r: CannedResponse) => {
    if (!query) return true;
    return (
      r.title.toLowerCase().includes(query) ||
      r.body.toLowerCase().includes(query) ||
      (r.shortcut && r.shortcut.toLowerCase().includes(query))
    );
  });

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && filtered.length > 0) {
        e.preventDefault();
        onSelect(expandVariables(filtered[selectedIndex].body));
      } else if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filtered, selectedIndex, onSelect, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  function expandVariables(body: string): string {
    const state = useStore.getState();
    return body
      .replace(/\{\{agentName\}\}/g, state.user?.name || '')
      .replace(/\{\{supportName\}\}/g, state.user?.name || '');
  }

  if (filtered.length === 0 && query) {
    return (
      <div ref={wrapperRef} className="relative">
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-bg-surface border border-border-heavy p-4 z-50">
          <p className="text-xs text-text-muted italic">{t('no_canned_responses') || 'No matching responses'}</p>
        </div>
      </div>
    );
  }

  if (filtered.length === 0) return null;

  return (
    <div ref={wrapperRef} className="relative">
      <div
        ref={listRef}
        className="absolute bottom-full left-0 right-0 mb-1 bg-bg-surface border border-border-heavy max-h-64 overflow-y-auto z-50"
      >
        <div className="px-3 py-2 border-b border-border">
          <span className="section-header">
            {t('canned_responses') || 'Quick replies'}
          </span>
        </div>
        {filtered.map((r: CannedResponse, idx: number) => (
          <button
            key={r.id}
            onClick={() => onSelect(expandVariables(r.body))}
            onMouseEnter={() => setSelectedIndex(idx)}
            className={`w-full text-left px-4 py-2.5 flex flex-col gap-0.5 ${
              idx === selectedIndex
                ? 'bg-bg-elevated'
                : 'hover:bg-bg-elevated'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-text-primary">{r.title}</span>
              {r.shortcut && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 bg-bg-elevated text-text-muted">
                  /{r.shortcut}
                </span>
              )}
              {r.dept && (
                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-border text-text-muted">
                  {r.dept}
                </span>
              )}
            </div>
            <span className="text-[11px] text-text-secondary truncate">{r.body}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

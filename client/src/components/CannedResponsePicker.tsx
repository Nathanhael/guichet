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
      <div className="absolute bottom-full left-0 right-0 mb-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-4 z-50">
        <p className="text-xs text-slate-400 italic">{t('no_canned_responses') || 'No matching responses'}</p>
      </div>
    );
  }

  if (filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl max-h-64 overflow-y-auto z-50"
    >
      <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
          {t('canned_responses') || 'Quick replies'}
        </span>
      </div>
      {filtered.map((r: CannedResponse, idx: number) => (
        <button
          key={r.id}
          onClick={() => onSelect(expandVariables(r.body))}
          onMouseEnter={() => setSelectedIndex(idx)}
          className={`w-full text-left px-4 py-2.5 flex flex-col gap-0.5 transition-colors ${
            idx === selectedIndex
              ? 'bg-blue-50 dark:bg-blue-950/30'
              : 'hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-900 dark:text-white">{r.title}</span>
            {r.shortcut && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                /{r.shortcut}
              </span>
            )}
            {r.dept && (
              <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-400">
                {r.dept}
              </span>
            )}
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{r.body}</span>
        </button>
      ))}
    </div>
  );
}

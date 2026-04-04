import { useState, useEffect, useRef } from 'react';
import { useT } from '../../i18n';
import type { Command } from '../../types/command';

interface CommandPaletteProps {
  commands: Command[];
  onClose: () => void;
}

/**
 * Searchable command palette overlay for SupportView.
 * Opens with Ctrl+K, filters commands by typed query, keyboard-navigable.
 * Brutalist design: no rounded corners, no shadows, monospace chrome.
 */
export default function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-focus search input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Filter commands by query
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const filtered = commands.filter((cmd) => {
    if (cmd.enabled === false) return false;
    if (!query) return true;
    const q = normalize(query);
    const label = normalize(t(cmd.labelKey) || cmd.labelKey);
    const keywordMatch = cmd.keywords?.some((kw) => normalize(kw).includes(q));
    return label.includes(q) || !!keywordMatch;
  });

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const items = listRef.current?.querySelectorAll('[data-cmd-item]');
    if (items && items[selectedIndex]) {
      (items[selectedIndex] as HTMLElement).scrollIntoView?.({ block: 'nearest' });
    }
  }, [selectedIndex]);

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
        filtered[selectedIndex].execute();
        onClose();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filtered, selectedIndex, onClose]);

  // Group commands by groupKey
  const groups: Array<{ groupKey: string | undefined; items: Array<Command & { flatIndex: number }> }> = [];
  let flatIndex = 0;
  for (const cmd of filtered) {
    const last = groups[groups.length - 1];
    if (last && last.groupKey === cmd.groupKey) {
      last.items.push({ ...cmd, flatIndex: flatIndex++ });
    } else {
      groups.push({ groupKey: cmd.groupKey, items: [{ ...cmd, flatIndex: flatIndex++ }] });
    }
  }

  return (
    <div className="fixed inset-0 z-[200]" role="dialog" aria-modal="true" aria-label={t('cmd_palette_title') || 'Command Palette'}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />

      {/* Panel */}
      <div className="absolute inset-0 flex items-start justify-center pt-[20vh]">
        <div className="w-full max-w-lg bg-[var(--color-bg-surface)] border border-[var(--color-border)] animate-fade-in">
          {/* Search input */}
          <div className="border-b border-[var(--color-border)] px-4 py-3 flex items-center gap-3">
            <span className="text-[var(--color-text-muted)] text-[11px] font-mono font-bold uppercase tracking-widest select-none">&gt;</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('cmd_palette_placeholder') || 'Type a command...'}
              className="flex-1 bg-transparent border-none text-[var(--color-text-primary)] text-sm font-mono placeholder:text-[var(--color-text-muted)] placeholder:opacity-40 focus:outline-none focus:ring-0"
            />
            <kbd className="text-[9px] font-mono px-1.5 py-0.5 border border-[var(--color-border)] text-[var(--color-text-muted)] select-none">ESC</kbd>
          </div>

          {/* Command list */}
          <div ref={listRef} className="max-h-80 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-4 py-6 text-center text-[var(--color-text-muted)] text-xs font-mono">
                {t('cmd_no_results') || 'No matching commands'}
              </div>
            )}

            {groups.map((group) => (
              <div key={group.groupKey || '_ungrouped'}>
                {group.groupKey && (
                  <div className="px-4 pt-3 pb-1 text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-muted)] select-none">
                    {t(group.groupKey) || group.groupKey}
                  </div>
                )}
                {group.items.map((cmd) => (
                  <button
                    key={cmd.id}
                    data-cmd-item
                    type="button"
                    onClick={() => { cmd.execute(); onClose(); }}
                    className={`w-full text-left px-4 py-2.5 flex items-center justify-between gap-2 transition-none cursor-pointer ${
                      cmd.flatIndex === selectedIndex
                        ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]'
                    }`}
                  >
                    <span className="text-[11px] font-mono font-bold uppercase tracking-wide truncate">
                      {t(cmd.labelKey) || cmd.labelKey}
                    </span>
                    {cmd.shortcutHint && (
                      <kbd className="text-[9px] font-mono px-1.5 py-0.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[var(--color-text-muted)] shrink-0 select-none">
                        {cmd.shortcutHint}
                      </kbd>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

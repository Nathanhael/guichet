import { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { useT } from '../../i18n';
import SectionLabel from '../ui/SectionLabel';
import type { Command } from '../../types/command';

interface CommandPaletteProps {
  commands: Command[];
  onClose: () => void;
}

export default function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const filtered = commands.filter((cmd) => {
    if (cmd.enabled === false) return false;
    if (!query) return true;
    const q = normalize(query);
    const label = normalize(t(cmd.labelKey) || cmd.labelKey);
    const keywordMatch = cmd.keywords?.some((kw) => normalize(kw).includes(q));
    return label.includes(q) || !!keywordMatch;
  });

  // Reset selection on query change; arrow-key navigation mutates it independently.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const items = listRef.current?.querySelectorAll('[data-cmd-item]');
    if (items && items[selectedIndex]) {
      (items[selectedIndex] as HTMLElement).scrollIntoView?.({ block: 'nearest' });
    }
  }, [selectedIndex]);

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
    <div className="fixed inset-0 z-[200]" role="dialog" aria-modal="true" aria-label={t('cmd_palette_title') || 'Command palette'}>
      <div className="absolute inset-0 bg-[var(--color-scrim)]" onClick={onClose} />

      <div className="absolute inset-0 flex items-start justify-center pt-[20vh] px-4">
        <div className="w-full max-w-lg rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-modal)] overflow-hidden animate-[v2p-pop_180ms_ease-out]">
          {/* Search input */}
          <div className="border-b border-[var(--color-border)] px-4 py-3 flex items-center gap-3">
            <Search className="h-4 w-4 text-[var(--color-ink-muted)] shrink-0" strokeWidth={2} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('cmd_palette_placeholder') || 'Type a command…'}
              className="flex-1 bg-transparent border-none text-[var(--color-ink)] text-[14px] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus:ring-0"
            />
            <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded-[var(--radius-btn)] border border-[var(--color-border)] text-[var(--color-ink-muted)] select-none">ESC</kbd>
          </div>

          <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-4 py-6 text-center text-[var(--color-ink-muted)] text-[12px]">
                {t('cmd_no_results') || 'No matching commands'}
              </div>
            )}

            {groups.map((group) => (
              <div key={group.groupKey || '_ungrouped'} className="py-1">
                {group.groupKey && (
                  <div className="px-4 pt-2 pb-1">
                    <SectionLabel>{t(group.groupKey) || group.groupKey}</SectionLabel>
                  </div>
                )}
                {group.items.map((cmd) => (
                  <button
                    key={cmd.id}
                    data-cmd-item
                    type="button"
                    onClick={() => { cmd.execute(); onClose(); }}
                    className={`w-full text-left px-4 py-2 flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                      cmd.flatIndex === selectedIndex
                        ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                        : 'text-[var(--color-ink)] hover:bg-[var(--color-hover)]'
                    }`}
                  >
                    <span className="text-[13px] font-medium truncate">
                      {t(cmd.labelKey) || cmd.labelKey}
                    </span>
                    {cmd.shortcutHint && (
                      <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[var(--color-ink-muted)] shrink-0 select-none">
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

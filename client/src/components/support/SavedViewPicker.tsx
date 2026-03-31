import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { trpc } from '../../utils/trpc';
import { Bookmark, Plus, Trash2, Star, X } from 'lucide-react';
import { useT } from '../../i18n';

export interface ViewFilters {
  dept?: string;
  tab?: 'queue' | 'archive' | 'search';
}

interface SavedViewPickerProps {
  currentFilters: ViewFilters;
  onApply: (filters: ViewFilters) => void;
}

export default function SavedViewPicker({ currentFilters, onApply }: SavedViewPickerProps) {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (isOpen && toggleRef.current) {
      const rect = toggleRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
      });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (toggleRef.current && !toggleRef.current.contains(e.target as Node)) {
        const dropdown = document.querySelector('[data-saved-view-dropdown]');
        if (dropdown && dropdown.contains(e.target as Node)) return;
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const utils = trpc.useUtils();

  const { data: views = [] } = trpc.savedView.list.useQuery();

  const createMutation = trpc.savedView.create.useMutation({
    onSuccess: () => {
      utils.savedView.list.invalidate();
      setSaveName('');
      setShowSaveInput(false);
    },
  });

  const deleteMutation = trpc.savedView.delete.useMutation({
    onSuccess: () => {
      utils.savedView.list.invalidate();
    },
  });

  const updateMutation = trpc.savedView.update.useMutation({
    onSuccess: () => {
      utils.savedView.list.invalidate();
    },
  });

  const hasFilters = Boolean(currentFilters.dept && currentFilters.dept !== 'all');

  function handleApply(filters: Record<string, unknown>) {
    onApply({
      dept: (filters.dept as string) || undefined,
      tab: (filters.tab as ViewFilters['tab']) || undefined,
    });
    setIsOpen(false);
  }

  function handleSetDefault(id: string, isDefault: boolean) {
    updateMutation.mutate({ id, isDefault: !isDefault });
  }

  function handleSave() {
    if (!saveName.trim()) return;
    createMutation.mutate({
      name: saveName.trim(),
      filters: currentFilters as Record<string, unknown>,
    });
  }

  return (
    <div className="relative">
      {/* Toggle button */}
      <button
        ref={toggleRef}
        onClick={() => setIsOpen((v) => !v)}
        className={[
          'w-7 h-7 flex items-center justify-center border border-[var(--color-border)] transition-colors',
          isOpen
            ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)]'
            : 'hover:bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]',
        ].join(' ')}
        title={t('savedViews') || 'Saved Views'}
        aria-label={t('savedViews') || 'Saved Views'}
      >
        <Bookmark size={12} />
      </button>

      {/* Dropdown */}
      {isOpen && createPortal(
        <div
          data-saved-view-dropdown
          className="fixed w-56 bg-[var(--color-bg-surface)] border border-[var(--color-border)] z-50 animate-fade-in"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
            <span className="font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
              {t('savedViews') || 'SAVED VIEWS'}
            </span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
              aria-label={t('close') || 'Close'}
            >
              <X size={10} />
            </button>
          </div>

          {/* View list */}
          <div className="max-h-48 overflow-y-auto">
            {views.length === 0 ? (
              <p className="font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-faint)] px-3 py-3">
                {t('noSavedViews') || 'No saved views'}
              </p>
            ) : (
              views.map((view) => (
                <div
                  key={view.id}
                  className="group flex items-center gap-1 px-3 py-2 hover:bg-[var(--color-bg-elevated)] transition-colors"
                >
                  {/* Apply button */}
                  <button
                    onClick={() => handleApply(view.filters as Record<string, unknown>)}
                    className="flex-1 text-left text-xs font-bold uppercase truncate text-[var(--color-text-primary)]"
                    title={view.name}
                  >
                    {view.name}
                  </button>

                  {/* Star / default toggle */}
                  <button
                    onClick={() => handleSetDefault(view.id, view.isDefault)}
                    className={[
                      'flex-shrink-0 transition-colors',
                      view.isDefault
                        ? 'text-[var(--color-accent-blue)] opacity-100'
                        : 'text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100',
                    ].join(' ')}
                    title={view.isDefault ? (t('removeDefault') || 'Remove default') : (t('setDefault') || 'Set as default')}
                    aria-label={view.isDefault ? (t('removeDefault') || 'Remove default') : (t('setDefault') || 'Set as default')}
                  >
                    <Star size={11} fill={view.isDefault ? 'currentColor' : 'none'} />
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={() => deleteMutation.mutate(view.id)}
                    className="flex-shrink-0 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-accent-red)] transition-colors"
                    title={t('delete') || 'Delete'}
                    aria-label={t('delete') || 'Delete'}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Save section */}
          <div className="border-t border-[var(--color-border)] px-3 py-2">
            {showSaveInput ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave();
                    if (e.key === 'Escape') {
                      setShowSaveInput(false);
                      setSaveName('');
                    }
                  }}
                  placeholder={t('viewName') || 'View name…'}
                  className="flex-1 min-w-0 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[var(--color-text-primary)] text-[10px] px-2 py-1 outline-none focus:border-[var(--color-accent-blue)]"
                  autoFocus
                />
                <button
                  onClick={handleSave}
                  disabled={!saveName.trim() || createMutation.isPending}
                  className="btn-primary text-[8px] px-2 py-1 disabled:opacity-20 disabled:cursor-not-allowed"
                >
                  {t('save') || 'Save'}
                </button>
                <button
                  onClick={() => {
                    setShowSaveInput(false);
                    setSaveName('');
                  }}
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                  aria-label={t('cancel') || 'Cancel'}
                >
                  <X size={11} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowSaveInput(true)}
                disabled={!hasFilters}
                className="flex items-center gap-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-20 disabled:cursor-not-allowed transition-colors w-full"
                title={!hasFilters ? (t('noActiveFilter') || 'Apply a filter first') : undefined}
              >
                <Plus size={11} />
                <span className="font-mono text-[9px] font-bold uppercase tracking-wide">
                  {t('saveCurrentView') || 'Save Current View'}
                </span>
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

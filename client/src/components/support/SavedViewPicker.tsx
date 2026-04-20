import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { trpc } from '../../utils/trpc';
import { Bookmark, Plus, Trash2, Star, X } from 'lucide-react';
import { useT } from '../../i18n';
import Button from '../ui/Button';
import SectionLabel from '../ui/SectionLabel';

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
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useLayoutEffect(() => {
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
        if (dropdownRef.current?.contains(e.target as Node)) return;
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const close = () => setIsOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
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
      <button
        ref={toggleRef}
        onClick={() => setIsOpen((v) => !v)}
        className={`w-7 h-7 flex items-center justify-center rounded-[var(--radius-btn)] border transition-colors ${
          isOpen
            ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-soft)]'
            : 'border-[var(--color-border)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-hover)]'
        }`}
        title={t('savedViews') || 'Saved views'}
        aria-label={t('savedViews') || 'Saved views'}
      >
        <Bookmark size={12} strokeWidth={2} />
      </button>

      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          data-saved-view-dropdown
          className="fixed w-60 rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)] z-50 overflow-hidden animate-[fade-in_150ms_ease-out]"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
            <SectionLabel>{t('savedViews') || 'Saved views'}</SectionLabel>
            <button
              onClick={() => setIsOpen(false)}
              className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors"
              aria-label={t('close') || 'Close'}
            >
              <X size={12} strokeWidth={2} />
            </button>
          </div>

          <div className="max-h-56 overflow-y-auto py-1">
            {views.length === 0 ? (
              <p className="text-[12px] text-[var(--color-ink-muted)] px-3 py-3">
                {t('noSavedViews') || 'No saved views'}
              </p>
            ) : (
              views.map((view) => (
                <div
                  key={view.id}
                  className="group flex items-center gap-1 px-3 py-1.5 hover:bg-[var(--color-hover)] transition-colors"
                >
                  <button
                    onClick={() => handleApply(view.filters as Record<string, unknown>)}
                    className="flex-1 text-left text-[12px] font-medium truncate text-[var(--color-ink)]"
                    title={view.name}
                  >
                    {view.name}
                  </button>

                  <button
                    onClick={() => handleSetDefault(view.id, view.isDefault)}
                    className={`flex-shrink-0 transition-opacity ${
                      view.isDefault
                        ? 'text-[var(--color-accent)] opacity-100'
                        : 'text-[var(--color-ink-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-accent)]'
                    }`}
                    title={view.isDefault ? (t('removeDefault') || 'Remove default') : (t('setDefault') || 'Set as default')}
                    aria-label={view.isDefault ? (t('removeDefault') || 'Remove default') : (t('setDefault') || 'Set as default')}
                  >
                    <Star size={12} strokeWidth={2} fill={view.isDefault ? 'currentColor' : 'none'} />
                  </button>

                  <button
                    onClick={() => deleteMutation.mutate(view.id)}
                    className="flex-shrink-0 text-[var(--color-ink-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-urgent)] transition-opacity"
                    title={t('delete') || 'Delete'}
                    aria-label={t('delete') || 'Delete'}
                  >
                    <Trash2 size={12} strokeWidth={2} />
                  </button>
                </div>
              ))
            )}
          </div>

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
                  className="flex-1 min-w-0 rounded-[var(--radius-btn)] bg-[var(--color-bg-base)] border border-[var(--color-border)] text-[var(--color-ink)] text-[12px] px-2 py-1 outline-none focus:border-[var(--color-accent)]"
                  autoFocus
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSave}
                  disabled={!saveName.trim() || createMutation.isPending}
                >
                  {t('save') || 'Save'}
                </Button>
                <button
                  onClick={() => {
                    setShowSaveInput(false);
                    setSaveName('');
                  }}
                  className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors"
                  aria-label={t('cancel') || 'Cancel'}
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowSaveInput(true)}
                disabled={!hasFilters}
                className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed w-full transition-colors"
                title={!hasFilters ? (t('noActiveFilter') || 'Apply a filter first') : undefined}
              >
                <Plus size={12} strokeWidth={2} />
                <span>
                  {t('saveCurrentView') || 'Save current view'}
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

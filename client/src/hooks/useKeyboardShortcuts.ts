import { useEffect } from 'react';

interface UseKeyboardShortcutsOptions {
  /** Set false to disable all listeners (e.g. when palette is open) */
  enabled: boolean;
  onOpenPalette: () => void;
  onFocusMessage: () => void;
  onNextTab: () => void;
  onPrevTab: () => void;
  onToggleSidebar: () => void;
}

/**
 * Global keyboard shortcut listener for SupportView.
 *
 * Direct shortcuts (AZERTY-safe):
 *  - Ctrl+K        → open command palette
 *  - Ctrl+ArrowDown → next chat tab
 *  - Ctrl+ArrowUp   → previous chat tab
 *  - Ctrl+B         → toggle queue sidebar
 *  - bare /         → focus message textarea (only when NOT inside an input)
 */
export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions): void {
  const { enabled, onOpenPalette, onFocusMessage, onNextTab, onPrevTab, onToggleSidebar } = options;

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+K — open command palette
      if (ctrl && e.key === 'k') {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      // Ctrl+ArrowDown — next tab
      if (ctrl && e.key === 'ArrowDown') {
        e.preventDefault();
        onNextTab();
        return;
      }

      // Ctrl+ArrowUp — previous tab
      if (ctrl && e.key === 'ArrowUp') {
        e.preventDefault();
        onPrevTab();
        return;
      }

      // Ctrl+B — toggle queue sidebar
      if (ctrl && e.key === 'b') {
        e.preventDefault();
        onToggleSidebar();
        return;
      }

      // Bare / — focus message input (only when not inside an input/textarea)
      if (e.key === '/' && !ctrl && !e.altKey && !e.shiftKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        const editable = (e.target as HTMLElement)?.isContentEditable;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;
        e.preventDefault();
        onFocusMessage();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onOpenPalette, onFocusMessage, onNextTab, onPrevTab, onToggleSidebar]);
}

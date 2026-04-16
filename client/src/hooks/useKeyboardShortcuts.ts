import { useEffect } from 'react';

interface UseKeyboardShortcutsOptions {
  /** Set false to disable all listeners (e.g. when palette is open) */
  enabled: boolean;
  onOpenPalette: () => void;
  onFocusMessage: () => void;
  onNextTab: () => void;
  onPrevTab: () => void;
  onToggleSidebar: () => void;
  onCloseTicket: () => void;
  onTransferTicket: () => void;
  onCloseTab: () => void;
  onToggleWhisper: () => void;
  onExitFocus: () => void;
}

/**
 * Global keyboard shortcut listener for SupportView.
 *
 * Direct shortcuts (AZERTY-safe):
 *  - Ctrl+K         → open command palette
 *  - ?              → open command palette (help)
 *  - Ctrl+ArrowDown → next chat tab
 *  - Ctrl+ArrowUp   → previous chat tab
 *  - Ctrl+B         → toggle queue sidebar
 *  - Ctrl+Enter     → close current ticket
 *  - Alt+T          → transfer ticket (avoids browser Ctrl+T)
 *  - Alt+W          → close chat tab (avoids browser Ctrl+W)
 *  - Ctrl+/         → toggle whisper mode
 *  - Esc            → exit focus mode (when nothing else consumes it)
 *  - bare /         → focus message textarea (only when NOT inside an input)
 */
export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions): void {
  const {
    enabled,
    onOpenPalette,
    onFocusMessage,
    onNextTab,
    onPrevTab,
    onToggleSidebar,
    onCloseTicket,
    onTransferTicket,
    onCloseTab,
    onToggleWhisper,
    onExitFocus,
  } = options;

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      const alt = e.altKey;

      // Ctrl+K — open command palette
      if (ctrl && e.key === 'k') {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      // ? — open command palette (help), only when not typing
      if (e.key === '?' && !ctrl && !alt) {
        const tag = (e.target as HTMLElement)?.tagName;
        const editable = (e.target as HTMLElement)?.isContentEditable;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;
        e.preventDefault();
        onOpenPalette();
        return;
      }

      // Ctrl+Enter — close current ticket
      if (ctrl && e.key === 'Enter') {
        e.preventDefault();
        onCloseTicket();
        return;
      }

      // Alt+T — transfer ticket (avoids browser Ctrl+T new-tab collision)
      if (alt && !ctrl && e.key.toLowerCase() === 't') {
        e.preventDefault();
        onTransferTicket();
        return;
      }

      // Alt+W — close chat tab (avoids browser Ctrl+W close-tab collision)
      if (alt && !ctrl && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        onCloseTab();
        return;
      }

      // Ctrl+/ — toggle whisper mode
      if (ctrl && e.key === '/') {
        e.preventDefault();
        onToggleWhisper();
        return;
      }

      // Esc — exit focus mode (palette/modals consume their own Escape first)
      if (e.key === 'Escape' && !ctrl && !alt) {
        onExitFocus();
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
  }, [
    enabled,
    onOpenPalette,
    onFocusMessage,
    onNextTab,
    onPrevTab,
    onToggleSidebar,
    onCloseTicket,
    onTransferTicket,
    onCloseTab,
    onToggleWhisper,
    onExitFocus,
  ]);
}

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
  onJumpToTab: (n: number) => void;
  onOpenSearch: () => void;
  onOpenLabelPicker: () => void;
  onOpenCannedPicker: () => void;
  onToggleAiCopilot: () => void;
  onOpenStatusPicker: () => void;
  onPrevUnread: () => void;
  onNextUnread: () => void;
  onToggleFocus: () => void;
}

/**
 * Global keyboard shortcut listener for SupportView.
 *
 * Tier-1 (AZERTY-safe):
 *  - Ctrl+K         → open command palette
 *  - ?              → open command palette (help)
 *  - Ctrl+ArrowDown → next chat tab
 *  - Ctrl+ArrowUp   → previous chat tab
 *  - Ctrl+B         → toggle queue sidebar
 *  - Ctrl+Enter     → close current ticket
 *  - Alt+T          → transfer ticket
 *  - Alt+W          → close chat tab
 *  - Ctrl+/         → toggle whisper
 *  - Esc            → exit focus mode
 *  - bare /         → focus message textarea
 *
 * Tier-2:
 *  - Ctrl+1..9      → jump to chat tab N (steals browser tab switch)
 *  - Ctrl+F         → open message search (steals browser Find)
 *  - Ctrl+L / Alt+L → open label picker
 *  - Ctrl+J / Alt+J → open canned response picker
 *  - Ctrl+Shift+A   → toggle AI copilot sidebar
 *  - Ctrl+.         → open status picker
 *
 * Tier-3:
 *  - Alt+ArrowUp    → jump to previous unread ticket in openTabs
 *  - Alt+ArrowDown  → jump to next unread ticket in openTabs
 *  - Ctrl+Shift+F   → toggle focus mode (enter AND exit; Esc only exits)
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
    onJumpToTab,
    onOpenSearch,
    onOpenLabelPicker,
    onOpenCannedPicker,
    onToggleAiCopilot,
    onOpenStatusPicker,
    onPrevUnread,
    onNextUnread,
    onToggleFocus,
  } = options;

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      const alt = e.altKey;
      const shift = e.shiftKey;

      // Ctrl+K — open command palette
      if (ctrl && !shift && e.key === 'k') {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      // ? — open command palette (help)
      if (e.key === '?' && !ctrl && !alt) {
        const tag = (e.target as HTMLElement)?.tagName;
        const editable = (e.target as HTMLElement)?.isContentEditable;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;
        e.preventDefault();
        onOpenPalette();
        return;
      }

      // Ctrl+Shift+A — toggle AI copilot (checked before plain Ctrl+letter)
      if (ctrl && shift && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        onToggleAiCopilot();
        return;
      }

      // Ctrl+Shift+F — toggle focus mode (checked before Ctrl+F search)
      if (ctrl && shift && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        onToggleFocus();
        return;
      }

      // Alt+ArrowUp / Alt+ArrowDown — prev/next unread ticket
      if (alt && !ctrl && !shift && e.key === 'ArrowUp') {
        e.preventDefault();
        onPrevUnread();
        return;
      }
      if (alt && !ctrl && !shift && e.key === 'ArrowDown') {
        e.preventDefault();
        onNextUnread();
        return;
      }

      // Ctrl+Enter — close ticket
      if (ctrl && e.key === 'Enter') {
        e.preventDefault();
        onCloseTicket();
        return;
      }

      // Ctrl+1..9 — jump to tab N
      if (ctrl && !alt && !shift && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        onJumpToTab(Number(e.key));
        return;
      }

      // Ctrl+F — open message search
      if (ctrl && !shift && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        onOpenSearch();
        return;
      }

      // Ctrl+L or Alt+L — open label picker (XOR on modifiers, no Shift)
      if ((ctrl !== alt) && !shift && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        onOpenLabelPicker();
        return;
      }

      // Ctrl+J or Alt+J — open canned response picker (XOR on modifiers, no Shift)
      if ((ctrl !== alt) && !shift && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        onOpenCannedPicker();
        return;
      }

      // Ctrl+. — open status picker
      if (ctrl && !shift && e.key === '.') {
        e.preventDefault();
        onOpenStatusPicker();
        return;
      }

      // Alt+T — transfer ticket
      if (alt && !ctrl && e.key.toLowerCase() === 't') {
        e.preventDefault();
        onTransferTicket();
        return;
      }

      // Alt+W — close chat tab
      if (alt && !ctrl && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        onCloseTab();
        return;
      }

      // Ctrl+/ — toggle whisper
      if (ctrl && e.key === '/') {
        e.preventDefault();
        onToggleWhisper();
        return;
      }

      // Esc — exit focus mode
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

      // Bare / — focus message input
      if (e.key === '/' && !ctrl && !alt && !shift) {
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
    onJumpToTab,
    onOpenSearch,
    onOpenLabelPicker,
    onOpenCannedPicker,
    onToggleAiCopilot,
    onOpenStatusPicker,
    onPrevUnread,
    onNextUnread,
    onToggleFocus,
  ]);
}

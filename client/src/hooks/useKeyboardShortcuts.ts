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
  onToggleFocus: () => void;
  onToggleMic: () => void;
}

/**
 * Global keyboard shortcut listener for SupportView.
 *
 * Tier-1 (AZERTY-safe):
 *  - Ctrl+K         → open command palette
 *  - ?              → open command palette (help)
 *  - Alt+ArrowDown  → next chat tab (+ focus compose)
 *  - Alt+ArrowUp    → previous chat tab (+ focus compose)
 *  - Ctrl+B         → toggle queue sidebar
 *  - Ctrl+Enter     → close current ticket
 *  - Alt+T          → transfer ticket
 *  - Alt+W          → close chat tab
 *  - Ctrl+/         → toggle whisper
 *  - Esc            → exit focus mode
 *  - bare /         → focus message textarea
 *
 * Tier-2:
 *  - Alt+1..9       → jump to chat tab N (Ctrl+1..9 reserved for browser tab switch)
 *  - Ctrl+F         → open message search (steals browser Find)
 *  - Alt+L          → open label picker (Ctrl+L reserved for browser address bar)
 *  - Alt+J          → open canned response picker (Ctrl+J reserved for browser downloads)
 *  - Ctrl+Shift+C   → toggle AI copilot sidebar (was Ctrl+Shift+A; freed Chrome tab search)
 *  - Ctrl+.         → open status picker
 *  - Ctrl+Shift+F   → toggle focus mode (enter AND exit; Esc only exits)
 *  - Alt+M          → toggle mic dictation (start/stop) on the active chat compose
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
    onToggleFocus,
    onToggleMic,
  } = options;

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      // Skip when a descendant handler has already consumed the event
      // (e.g. CommandPalette / SearchBar call preventDefault on Escape).
      if (e.defaultPrevented) return;

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

      // Ctrl+Shift+C — toggle AI copilot (checked before plain Ctrl+letter)
      if (ctrl && shift && e.key.toLowerCase() === 'c') {
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

      // Alt+ArrowUp / Alt+ArrowDown — prev/next chat tab (+ focus compose)
      if (alt && !ctrl && !shift && e.key === 'ArrowUp') {
        e.preventDefault();
        onPrevTab();
        return;
      }
      if (alt && !ctrl && !shift && e.key === 'ArrowDown') {
        e.preventDefault();
        onNextTab();
        return;
      }

      // Ctrl+Enter — close ticket
      if (ctrl && e.key === 'Enter') {
        e.preventDefault();
        onCloseTicket();
        return;
      }

      // Alt+1..9 — jump to tab N. Match on e.code (physical key) so AZERTY
      // layouts where digit row needs Shift still work. Ctrl+1..9 left alone
      // so browser tab switch still works.
      if (alt && !ctrl && /^Digit[1-9]$/.test(e.code)) {
        e.preventDefault();
        onJumpToTab(Number(e.code.slice(5)));
        return;
      }

      // Ctrl+F — open message search
      if (ctrl && !shift && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        onOpenSearch();
        return;
      }

      // Alt+L — open label picker (Ctrl+L left alone so browser address bar still works)
      if (alt && !ctrl && !shift && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        onOpenLabelPicker();
        return;
      }

      // Alt+J — open canned response picker (Ctrl+J left alone so browser downloads still work)
      if (alt && !ctrl && !shift && e.key.toLowerCase() === 'j') {
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

      // Alt+M — toggle mic dictation. ComposeArea owns the gating: silently
      // no-ops if voice transcription is disabled for the partner, the
      // browser lacks MediaRecorder, or a transcription is already in flight.
      if (alt && !ctrl && !shift && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        onToggleMic();
        return;
      }

      // Ctrl+/ — toggle whisper. Match on e.key so AZERTY layouts where `/`
      // is produced by Shift+: still fire (physical Slash position on AZERTY
      // is `!`/`§`, not `/`, so e.code === 'Slash' would be wrong).
      if (ctrl && e.key === '/') {
        e.preventDefault();
        onToggleWhisper();
        return;
      }

      // Esc — exit focus mode
      // Skip when any modal/dialog is open; its own Esc handler owns the event.
      if (e.key === 'Escape' && !ctrl && !alt) {
        if (document.querySelector('[role="dialog"]')) return;
        onExitFocus();
        return;
      }

      // Ctrl+B — toggle queue sidebar
      if (ctrl && e.key === 'b') {
        e.preventDefault();
        onToggleSidebar();
        return;
      }

      // Bare / — focus message input. Accept `/` regardless of Shift so AZERTY
      // (where Shift+: is needed to produce `/`) still fires.
      if (e.key === '/' && !ctrl && !alt) {
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
    onToggleFocus,
    onToggleMic,
  ]);
}

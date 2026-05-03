/**
 * Command Palette types for SupportView keyboard shortcuts.
 */

export interface Command {
  /** Unique identifier */
  id: string;
  /** i18n key for the display label */
  labelKey: string;
  /** i18n key for the group/category header */
  groupKey?: string;
  /** Human-readable shortcut hint (e.g. "Ctrl+K") */
  shortcutHint?: string;
  /** Execute the command — context is closed over, no args needed */
  execute: () => void;
  /** Whether the command is currently available (default true) */
  enabled?: boolean;
  /** Extra search terms beyond the translated label */
  keywords?: string[];
}

/**
 * Imperative handle exposed by ChatWindow via forwardRef.
 * Keeps the surface minimal — only actions the palette needs to trigger.
 */
export interface ChatWindowHandle {
  focusTextarea: () => void;
  toggleWhisper: () => void;
  toggleMic: () => void;
  openTransferMenu: () => void;
  triggerCloseTicket: () => void;
}

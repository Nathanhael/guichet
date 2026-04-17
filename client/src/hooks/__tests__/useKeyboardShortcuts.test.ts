import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';

describe('useKeyboardShortcuts', () => {
  const handlers = {
    onOpenPalette: vi.fn(),
    onFocusMessage: vi.fn(),
    onNextTab: vi.fn(),
    onPrevTab: vi.fn(),
    onToggleSidebar: vi.fn(),
    onCloseTicket: vi.fn(),
    onTransferTicket: vi.fn(),
    onCloseTab: vi.fn(),
    onToggleWhisper: vi.fn(),
    onExitFocus: vi.fn(),
    onJumpToTab: vi.fn(),
    onOpenSearch: vi.fn(),
    onOpenLabelPicker: vi.fn(),
    onOpenCannedPicker: vi.fn(),
    onToggleAiCopilot: vi.fn(),
    onOpenStatusPicker: vi.fn(),
    onPrevUnread: vi.fn(),
    onNextUnread: vi.fn(),
    onToggleFocus: vi.fn(),
  };

  function fire(key: string, opts: Partial<KeyboardEventInit> = {}) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
  }

  function fireOnElement(el: HTMLElement, key: string, opts: Partial<KeyboardEventInit> = {}) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, ...opts });
    Object.defineProperty(event, 'target', { value: el, writable: false });
    window.dispatchEvent(event);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Ctrl+K fires onOpenPalette', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('k', { ctrlKey: true });
    expect(handlers.onOpenPalette).toHaveBeenCalledOnce();
  });

  it('Ctrl+ArrowDown fires onNextTab', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('ArrowDown', { ctrlKey: true });
    expect(handlers.onNextTab).toHaveBeenCalledOnce();
  });

  it('Ctrl+ArrowUp fires onPrevTab', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('ArrowUp', { ctrlKey: true });
    expect(handlers.onPrevTab).toHaveBeenCalledOnce();
  });

  it('Ctrl+B fires onToggleSidebar', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('b', { ctrlKey: true });
    expect(handlers.onToggleSidebar).toHaveBeenCalledOnce();
  });

  it('bare / fires onFocusMessage when target is body', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fireOnElement(document.body, '/');
    expect(handlers.onFocusMessage).toHaveBeenCalledOnce();
  });

  it('bare / does NOT fire when target is a textarea', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    fireOnElement(textarea, '/');
    expect(handlers.onFocusMessage).not.toHaveBeenCalled();
    textarea.remove();
  });

  it('bare / does NOT fire when target is an input', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireOnElement(input, '/');
    expect(handlers.onFocusMessage).not.toHaveBeenCalled();
    input.remove();
  });

  it('bare / does NOT fire when target is a contenteditable element', () => {
    // Tiptap's compose editor renders a contenteditable div rather than
    // a <textarea>, so the guard must skip the shortcut when the cursor
    // is inside rich-text editable regions too. Regression coverage for
    // the code-review finding that flagged this as an untested branch.
    //
    // jsdom doesn't compute `isContentEditable` from the contenteditable
    // attribute the way real browsers do (it depends on layout + focus),
    // so we force the property on the element before dispatch. The
    // production guard reads `el.isContentEditable`; in real browsers a
    // real contenteditable div exposes `true` automatically.
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    Object.defineProperty(editable, 'isContentEditable', {
      value: true,
      configurable: true,
    });
    document.body.appendChild(editable);
    fireOnElement(editable, '/');
    expect(handlers.onFocusMessage).not.toHaveBeenCalled();
    editable.remove();
  });

  it('nothing fires when enabled is false', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: false, ...handlers }));
    fire('k', { ctrlKey: true });
    fire('ArrowDown', { ctrlKey: true });
    fire('b', { ctrlKey: true });
    fireOnElement(document.body, '/');
    expect(handlers.onOpenPalette).not.toHaveBeenCalled();
    expect(handlers.onNextTab).not.toHaveBeenCalled();
    expect(handlers.onToggleSidebar).not.toHaveBeenCalled();
    expect(handlers.onFocusMessage).not.toHaveBeenCalled();
  });

  it('metaKey (Cmd on Mac) works as Ctrl alternative', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('k', { metaKey: true });
    expect(handlers.onOpenPalette).toHaveBeenCalledOnce();
  });

  it('Ctrl+Enter fires onCloseTicket', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('Enter', { ctrlKey: true });
    expect(handlers.onCloseTicket).toHaveBeenCalledOnce();
  });

  it('Alt+T fires onTransferTicket', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('t', { altKey: true });
    expect(handlers.onTransferTicket).toHaveBeenCalledOnce();
  });

  it('Alt+W fires onCloseTab', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('w', { altKey: true });
    expect(handlers.onCloseTab).toHaveBeenCalledOnce();
  });

  it('Ctrl+Alt+T does NOT fire onTransferTicket (Alt-only binding)', () => {
    // Guards against accidental double-trigger if users hold Ctrl while
    // pressing Alt+T. Alt+T requires Alt without Ctrl.
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('t', { altKey: true, ctrlKey: true });
    expect(handlers.onTransferTicket).not.toHaveBeenCalled();
  });

  it('Ctrl+/ fires onToggleWhisper', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('/', { ctrlKey: true });
    expect(handlers.onToggleWhisper).toHaveBeenCalledOnce();
  });

  it('Escape fires onExitFocus', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('Escape');
    expect(handlers.onExitFocus).toHaveBeenCalledOnce();
  });

  it('Escape does NOT fire onExitFocus when a role=dialog is open', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    fire('Escape');
    expect(handlers.onExitFocus).not.toHaveBeenCalled();
    dialog.remove();
  });

  it('shortcut is skipped when the event has defaultPrevented set', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);
    expect(handlers.onExitFocus).not.toHaveBeenCalled();
  });

  it('? fires onOpenPalette when target is body', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fireOnElement(document.body, '?');
    expect(handlers.onOpenPalette).toHaveBeenCalledOnce();
  });

  it('? does NOT fire onOpenPalette when target is a textarea', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    fireOnElement(textarea, '?');
    expect(handlers.onOpenPalette).not.toHaveBeenCalled();
    textarea.remove();
  });

  // ── Tier-2 ───────────────────────────────────────────────────────────────

  it('Ctrl+1 fires onJumpToTab with 1', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('1', { ctrlKey: true });
    expect(handlers.onJumpToTab).toHaveBeenCalledWith(1);
  });

  it('Ctrl+9 fires onJumpToTab with 9', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('9', { ctrlKey: true });
    expect(handlers.onJumpToTab).toHaveBeenCalledWith(9);
  });

  it('Ctrl+0 does NOT fire onJumpToTab (outside 1..9 range)', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('0', { ctrlKey: true });
    expect(handlers.onJumpToTab).not.toHaveBeenCalled();
  });

  it('Ctrl+F fires onOpenSearch', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('f', { ctrlKey: true });
    expect(handlers.onOpenSearch).toHaveBeenCalledOnce();
  });

  it('Ctrl+L fires onOpenLabelPicker', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('l', { ctrlKey: true });
    expect(handlers.onOpenLabelPicker).toHaveBeenCalledOnce();
  });

  it('Alt+L also fires onOpenLabelPicker (browser/AZERTY-safe fallback)', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('l', { altKey: true });
    expect(handlers.onOpenLabelPicker).toHaveBeenCalledOnce();
  });

  it('Ctrl+J fires onOpenCannedPicker', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('j', { ctrlKey: true });
    expect(handlers.onOpenCannedPicker).toHaveBeenCalledOnce();
  });

  it('Alt+J also fires onOpenCannedPicker', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('j', { altKey: true });
    expect(handlers.onOpenCannedPicker).toHaveBeenCalledOnce();
  });

  it('Ctrl+Shift+A fires onToggleAiCopilot', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('a', { ctrlKey: true, shiftKey: true });
    expect(handlers.onToggleAiCopilot).toHaveBeenCalledOnce();
  });

  it('Ctrl+A without Shift does NOT fire onToggleAiCopilot (preserve select-all)', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('a', { ctrlKey: true });
    expect(handlers.onToggleAiCopilot).not.toHaveBeenCalled();
  });

  it('Ctrl+. fires onOpenStatusPicker', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('.', { ctrlKey: true });
    expect(handlers.onOpenStatusPicker).toHaveBeenCalledOnce();
  });

  // ── Tier-3 ───────────────────────────────────────────────────────────────

  it('Alt+ArrowUp fires onPrevUnread', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('ArrowUp', { altKey: true });
    expect(handlers.onPrevUnread).toHaveBeenCalledOnce();
  });

  it('Alt+ArrowDown fires onNextUnread', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('ArrowDown', { altKey: true });
    expect(handlers.onNextUnread).toHaveBeenCalledOnce();
  });

  it('Ctrl+Shift+F fires onToggleFocus', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('f', { ctrlKey: true, shiftKey: true });
    expect(handlers.onToggleFocus).toHaveBeenCalledOnce();
  });

  it('Ctrl+F without Shift still fires onOpenSearch (not onToggleFocus)', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('f', { ctrlKey: true });
    expect(handlers.onOpenSearch).toHaveBeenCalledOnce();
    expect(handlers.onToggleFocus).not.toHaveBeenCalled();
  });
});

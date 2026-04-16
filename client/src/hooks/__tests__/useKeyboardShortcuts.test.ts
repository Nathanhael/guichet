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
});

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
});

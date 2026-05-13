import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, renderHook } from '@testing-library/react';
import { useResizableSidebar } from './useResizableSidebar';

const KEY = 'test-sidebar-width';
const baseOpts = { storageKey: KEY, defaultWidth: 240, min: 200, max: 400 };

describe('useResizableSidebar', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns defaultWidth when storage is empty', () => {
    const { result } = renderHook(() => useResizableSidebar(baseOpts));
    expect(result.current.width).toBe(240);
  });

  it('returns the persisted width when storage has a valid value', () => {
    localStorage.setItem(KEY, '320');
    const { result } = renderHook(() => useResizableSidebar(baseOpts));
    expect(result.current.width).toBe(320);
  });

  it('clamps an under-min persisted value up to min', () => {
    localStorage.setItem(KEY, '50');
    const { result } = renderHook(() => useResizableSidebar(baseOpts));
    expect(result.current.width).toBe(200);
  });

  it('clamps an over-max persisted value down to max', () => {
    localStorage.setItem(KEY, '900');
    const { result } = renderHook(() => useResizableSidebar(baseOpts));
    expect(result.current.width).toBe(400);
  });

  it('falls back to defaultWidth when the persisted value is non-numeric', () => {
    localStorage.setItem(KEY, 'banana');
    const { result } = renderHook(() => useResizableSidebar(baseOpts));
    expect(result.current.width).toBe(240);
  });

  it('updates width as the drag advances and persists on mouseup', () => {
    const { result } = renderHook(() => useResizableSidebar(baseOpts));

    // Simulate mousedown by calling onDragStart with a synthetic event-like
    // object — only clientX + preventDefault are used.
    act(() => {
      result.current.onDragStart({
        clientX: 100,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent<HTMLDivElement>);
    });

    // Drag right 50px — width should grow from 240 to 290.
    act(() => {
      fireEvent.mouseMove(document, { clientX: 150 });
    });
    expect(result.current.width).toBe(290);

    // Release the mouse — width persists to localStorage.
    act(() => {
      fireEvent.mouseUp(document);
    });
    expect(localStorage.getItem(KEY)).toBe('290');
  });

  it('clamps the drag width to max', () => {
    const { result } = renderHook(() => useResizableSidebar(baseOpts));

    act(() => {
      result.current.onDragStart({
        clientX: 0,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent<HTMLDivElement>);
    });

    act(() => {
      fireEvent.mouseMove(document, { clientX: 1000 });
    });
    expect(result.current.width).toBe(400);
  });

  it('clamps the drag width to min', () => {
    const { result } = renderHook(() => useResizableSidebar(baseOpts));

    act(() => {
      result.current.onDragStart({
        clientX: 1000,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent<HTMLDivElement>);
    });

    act(() => {
      fireEvent.mouseMove(document, { clientX: 0 });
    });
    expect(result.current.width).toBe(200);
  });

  it('does not persist when mouseup fires without a prior drag start', () => {
    renderHook(() => useResizableSidebar(baseOpts));

    act(() => {
      fireEvent.mouseUp(document);
    });

    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

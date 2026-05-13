import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePanelMutations } from './usePanelMutations';

describe('usePanelMutations', () => {
  it('starts with a null toast', () => {
    const { result } = renderHook(() => usePanelMutations());
    expect(result.current.toast).toBeNull();
  });

  it('runs the custom onSuccess then invalidates on success', async () => {
    const order: string[] = [];
    const invalidate = vi.fn(async () => {
      order.push('invalidate');
    });
    const customSuccess = vi.fn(() => {
      order.push('custom');
    });

    const { result } = renderHook(() => usePanelMutations());
    const opts = result.current.defaults<{ id: string }, { name: string }>({
      invalidate,
      onSuccess: customSuccess,
    });

    await act(async () => {
      await opts.onSuccess({ id: '1' }, { name: 'foo' });
    });

    expect(customSuccess).toHaveBeenCalledWith({ id: '1' }, { name: 'foo' });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['custom', 'invalidate']);
    expect(result.current.toast).toBeNull();
  });

  it('emits a success toast when successMessage is provided', async () => {
    const invalidate = vi.fn(async () => {});

    const { result } = renderHook(() => usePanelMutations());
    const opts = result.current.defaults({
      invalidate,
      successMessage: 'Saved',
    });

    await act(async () => {
      await opts.onSuccess(null, null);
    });

    expect(result.current.toast).toEqual({ message: 'Saved', type: 'success' });
  });

  it('sets an error toast and runs the custom onError on failure', () => {
    const invalidate = vi.fn();
    const customError = vi.fn();

    const { result } = renderHook(() => usePanelMutations());
    const opts = result.current.defaults<unknown, { id: string }>({
      invalidate,
      onError: customError,
    });

    act(() => {
      opts.onError({ message: 'Boom' }, { id: '1' });
    });

    expect(invalidate).not.toHaveBeenCalled();
    expect(customError).toHaveBeenCalledWith({ message: 'Boom' }, { id: '1' });
    expect(result.current.toast).toEqual({ message: 'Boom', type: 'error' });
  });

  it('clears the toast when setToast(null) is called', () => {
    const invalidate = vi.fn();

    const { result } = renderHook(() => usePanelMutations());
    const opts = result.current.defaults({ invalidate });

    act(() => {
      opts.onError({ message: 'Boom' }, undefined);
    });
    expect(result.current.toast).toEqual({ message: 'Boom', type: 'error' });

    act(() => {
      result.current.setToast(null);
    });
    expect(result.current.toast).toBeNull();
  });
});

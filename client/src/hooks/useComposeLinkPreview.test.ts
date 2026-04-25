import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../utils/trpc', () => ({
  trpc: {
    linkPreview: {
      fetchForCompose: {
        useQuery: vi.fn(),
      },
    },
  },
}));

import { trpc } from '../utils/trpc';
import { useComposeLinkPreview } from './useComposeLinkPreview';

type QueryArgs = [
  { text: string },
  { enabled: boolean; staleTime?: number; retry?: number },
];

function getQueryMock() {
  return trpc.linkPreview.fetchForCompose.useQuery as unknown as ReturnType<typeof vi.fn>;
}

function lastQueryCall(): QueryArgs {
  const mock = getQueryMock();
  return mock.mock.calls[mock.mock.calls.length - 1] as QueryArgs;
}

const preview = {
  url: 'https://example.com/path',
  title: 'Example',
  description: 'desc',
  image: 'https://example.com/img.png',
  siteName: 'Example',
};

describe('useComposeLinkPreview', () => {
  beforeEach(() => {
    getQueryMock().mockReset();
    getQueryMock().mockReturnValue({ data: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('800ms debounce', () => {
    it('does not forward the new text to useQuery before 800ms have elapsed', () => {
      vi.useFakeTimers();
      const { rerender } = renderHook(({ text }) => useComposeLinkPreview({ text }), {
        initialProps: { text: '' },
      });

      rerender({ text: 'look https://example.com/path here' });

      // Timers paused at t=0: debouncedText still ''
      act(() => {
        vi.advanceTimersByTime(799);
      });

      const [input, options] = lastQueryCall();
      expect(input.text).toBe('');
      expect(options.enabled).toBe(false);
    });

    it('forwards the new text to useQuery exactly at 800ms', () => {
      vi.useFakeTimers();
      const { rerender } = renderHook(({ text }) => useComposeLinkPreview({ text }), {
        initialProps: { text: '' },
      });

      rerender({ text: 'look https://example.com/path here' });
      act(() => {
        vi.advanceTimersByTime(800);
      });

      const [input, options] = lastQueryCall();
      expect(input.text).toBe('look https://example.com/path here');
      expect(options.enabled).toBe(true);
    });

    it('coalesces rapid keystrokes — only the final text lands in useQuery', () => {
      vi.useFakeTimers();
      const { rerender } = renderHook(({ text }) => useComposeLinkPreview({ text }), {
        initialProps: { text: '' },
      });

      rerender({ text: 'https://e' });
      act(() => vi.advanceTimersByTime(300));
      rerender({ text: 'https://ex' });
      act(() => vi.advanceTimersByTime(300));
      rerender({ text: 'https://example.com/path' });
      act(() => vi.advanceTimersByTime(300));

      // At t=900 since first keystroke, but only 300ms since last change —
      // debouncedText not yet flushed.
      const [midInput] = lastQueryCall();
      expect(midInput.text).toBe('');

      act(() => vi.advanceTimersByTime(500)); // 500 more -> 800 since last change
      const [finalInput, finalOptions] = lastQueryCall();
      expect(finalInput.text).toBe('https://example.com/path');
      expect(finalOptions.enabled).toBe(true);
    });

    it('keeps useQuery disabled for short or URL-less text even after debounce', () => {
      vi.useFakeTimers();
      const { rerender } = renderHook(({ text }) => useComposeLinkPreview({ text }), {
        initialProps: { text: '' },
      });

      rerender({ text: 'no url here just words' });
      act(() => vi.advanceTimersByTime(800));

      const [, options] = lastQueryCall();
      expect(options.enabled).toBe(false);
    });
  });

  describe('dismiss → hidden', () => {
    it('returns query data as livePreview until dismiss(url) is called', () => {
      getQueryMock().mockReturnValue({ data: preview });

      const { result } = renderHook(() =>
        useComposeLinkPreview({ text: 'check https://example.com/path out' }),
      );

      expect(result.current.livePreview).toEqual(preview);

      act(() => result.current.dismiss(preview.url));
      expect(result.current.livePreview).toBeNull();
    });

    it('keeps livePreview hidden on subsequent renders while the URL is still in the buffer', () => {
      getQueryMock().mockReturnValue({ data: preview });

      const { result, rerender } = renderHook(({ text }) => useComposeLinkPreview({ text }), {
        initialProps: { text: 'check https://example.com/path out' },
      });

      act(() => result.current.dismiss(preview.url));
      expect(result.current.livePreview).toBeNull();

      rerender({ text: 'still has https://example.com/path here' });
      expect(result.current.livePreview).toBeNull();
    });
  });

  describe('URL-removed → dismissed-set regen', () => {
    it('re-shows the preview after the dismissed URL is removed from the buffer and retyped', () => {
      getQueryMock().mockReturnValue({ data: preview });

      const { result, rerender } = renderHook(({ text }) => useComposeLinkPreview({ text }), {
        initialProps: { text: 'check https://example.com/path out' },
      });

      act(() => result.current.dismiss(preview.url));
      expect(result.current.livePreview).toBeNull();

      // User deletes the URL from the compose buffer. The dismissed-set
      // regen effect should clear the entry so a retype re-shows the card.
      rerender({ text: 'plain text now' });
      rerender({ text: 'back again https://example.com/path' });

      expect(result.current.livePreview).toEqual(preview);
    });

    it('keeps the dismissed entry while the same URL stays in the buffer', () => {
      getQueryMock().mockReturnValue({ data: preview });

      const { result, rerender } = renderHook(({ text }) => useComposeLinkPreview({ text }), {
        initialProps: { text: 'check https://example.com/path out' },
      });

      act(() => result.current.dismiss(preview.url));
      rerender({ text: 'still https://example.com/path still here' });
      rerender({ text: 'prefix https://example.com/path suffix' });
      expect(result.current.livePreview).toBeNull();
    });
  });
});

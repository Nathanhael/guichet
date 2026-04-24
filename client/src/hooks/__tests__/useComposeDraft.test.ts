import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { User } from '../../types';

const user: User = {
  id: 'u1',
  name: 'Test User',
  role: 'support',
  lang: 'en',
  isPlatformOperator: false,
};

const DAY_MS = 24 * 60 * 60 * 1000;

describe('useComposeDraft', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('module-level TTL purge', () => {
    it('removes drafts older than 24h on module load and keeps fresh ones', async () => {
      const now = Date.now();
      localStorage.setItem(
        'guichet:draft:u1:t-stale:regular',
        JSON.stringify({ text: 'old', ts: now - DAY_MS - 1000 }),
      );
      localStorage.setItem(
        'guichet:draft:u1:t-fresh:regular',
        JSON.stringify({ text: 'fresh', ts: now - 1000 }),
      );
      localStorage.setItem('guichet:draft:u1:t-corrupt:regular', 'not-json');
      localStorage.setItem('guichet:draft:u1:t-nots:regular', JSON.stringify({ text: 'x' }));
      localStorage.setItem('unrelated:key', 'keep');

      await import('../useComposeDraft');

      expect(localStorage.getItem('guichet:draft:u1:t-stale:regular')).toBeNull();
      expect(localStorage.getItem('guichet:draft:u1:t-fresh:regular')).not.toBeNull();
      expect(localStorage.getItem('guichet:draft:u1:t-corrupt:regular')).toBeNull();
      expect(localStorage.getItem('guichet:draft:u1:t-nots:regular')).toBeNull();
      expect(localStorage.getItem('unrelated:key')).toBe('keep');
    });
  });

  describe('debounced save (400ms)', () => {
    it('does not persist before 400ms have elapsed', async () => {
      vi.useFakeTimers();
      const { useComposeDraft } = await import('../useComposeDraft');
      const setText = vi.fn();
      const { rerender } = renderHook(
        ({ text }) =>
          useComposeDraft({ user, ticketId: 't1', whisperMode: false, text, setText }),
        { initialProps: { text: '' } },
      );
      rerender({ text: 'hello' });
      vi.advanceTimersByTime(399);
      expect(localStorage.getItem('guichet:draft:u1:t1:regular')).toBeNull();
    });

    it('persists the draft exactly at 400ms', async () => {
      vi.useFakeTimers();
      const { useComposeDraft } = await import('../useComposeDraft');
      const setText = vi.fn();
      const { rerender } = renderHook(
        ({ text }) =>
          useComposeDraft({ user, ticketId: 't1', whisperMode: false, text, setText }),
        { initialProps: { text: '' } },
      );
      rerender({ text: 'hello' });
      vi.advanceTimersByTime(400);
      const raw = localStorage.getItem('guichet:draft:u1:t1:regular');
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.text).toBe('hello');
      expect(typeof parsed.ts).toBe('number');
    });

    it('removes the draft when text is emptied', async () => {
      vi.useFakeTimers();
      const { useComposeDraft } = await import('../useComposeDraft');
      localStorage.setItem(
        'guichet:draft:u1:t1:regular',
        JSON.stringify({ text: 'prior', ts: Date.now() }),
      );
      const setText = vi.fn();
      renderHook(() =>
        useComposeDraft({ user, ticketId: 't1', whisperMode: false, text: '', setText }),
      );
      vi.advanceTimersByTime(400);
      expect(localStorage.getItem('guichet:draft:u1:t1:regular')).toBeNull();
    });

    it('coalesces rapid keystrokes into a single save', async () => {
      vi.useFakeTimers();
      const { useComposeDraft } = await import('../useComposeDraft');
      const setText = vi.fn();
      const { rerender } = renderHook(
        ({ text }) =>
          useComposeDraft({ user, ticketId: 't1', whisperMode: false, text, setText }),
        { initialProps: { text: '' } },
      );
      rerender({ text: 'h' });
      vi.advanceTimersByTime(200);
      rerender({ text: 'he' });
      vi.advanceTimersByTime(200);
      rerender({ text: 'hel' });
      vi.advanceTimersByTime(200);
      expect(localStorage.getItem('guichet:draft:u1:t1:regular')).toBeNull();
      vi.advanceTimersByTime(200);
      const raw = localStorage.getItem('guichet:draft:u1:t1:regular');
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!).text).toBe('hel');
    });
  });

  describe('re-hydration on key change', () => {
    it('loads the draft matching the active ticketId', async () => {
      const { useComposeDraft } = await import('../useComposeDraft');
      localStorage.setItem(
        'guichet:draft:u1:t1:regular',
        JSON.stringify({ text: 'from t1', ts: Date.now() }),
      );
      localStorage.setItem(
        'guichet:draft:u1:t2:regular',
        JSON.stringify({ text: 'from t2', ts: Date.now() }),
      );
      const setText = vi.fn();
      const { rerender } = renderHook(
        ({ ticketId }) =>
          useComposeDraft({ user, ticketId, whisperMode: false, text: '', setText }),
        { initialProps: { ticketId: 't1' } },
      );
      expect(setText).toHaveBeenLastCalledWith('from t1');
      setText.mockClear();
      rerender({ ticketId: 't2' });
      expect(setText).toHaveBeenLastCalledWith('from t2');
    });

    it('loads separate drafts for whisper vs regular mode', async () => {
      const { useComposeDraft } = await import('../useComposeDraft');
      localStorage.setItem(
        'guichet:draft:u1:t1:regular',
        JSON.stringify({ text: 'public', ts: Date.now() }),
      );
      localStorage.setItem(
        'guichet:draft:u1:t1:whisper',
        JSON.stringify({ text: 'private', ts: Date.now() }),
      );
      const setText = vi.fn();
      const { rerender } = renderHook(
        ({ whisperMode }) =>
          useComposeDraft({ user, ticketId: 't1', whisperMode, text: '', setText }),
        { initialProps: { whisperMode: false } },
      );
      expect(setText).toHaveBeenLastCalledWith('public');
      setText.mockClear();
      rerender({ whisperMode: true });
      expect(setText).toHaveBeenLastCalledWith('private');
    });

    it('clears text and removes entry when stored draft is stale', async () => {
      const { useComposeDraft } = await import('../useComposeDraft');
      localStorage.setItem(
        'guichet:draft:u1:t1:regular',
        JSON.stringify({ text: 'old', ts: Date.now() - DAY_MS - 1000 }),
      );
      const setText = vi.fn();
      renderHook(() =>
        useComposeDraft({ user, ticketId: 't1', whisperMode: false, text: '', setText }),
      );
      expect(setText).toHaveBeenLastCalledWith('');
      expect(localStorage.getItem('guichet:draft:u1:t1:regular')).toBeNull();
    });

    it('clears text when no stored draft exists for the key', async () => {
      const { useComposeDraft } = await import('../useComposeDraft');
      const setText = vi.fn();
      renderHook(() =>
        useComposeDraft({ user, ticketId: 't1', whisperMode: false, text: '', setText }),
      );
      expect(setText).toHaveBeenLastCalledWith('');
    });

    it('falls back to "anon" when user is null', async () => {
      const { useComposeDraft } = await import('../useComposeDraft');
      localStorage.setItem(
        'guichet:draft:anon:t1:regular',
        JSON.stringify({ text: 'guest draft', ts: Date.now() }),
      );
      const setText = vi.fn();
      renderHook(() =>
        useComposeDraft({ user: null, ticketId: 't1', whisperMode: false, text: '', setText }),
      );
      expect(setText).toHaveBeenLastCalledWith('guest draft');
    });
  });
});

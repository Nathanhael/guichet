import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../utils/trpc', () => ({
  trpc: {
    ai: {
      improveMessage: {
        useMutation: vi.fn(),
      },
    },
  },
}));

import { trpc } from '../utils/trpc';
import { useComposeAiImprove } from './useComposeAiImprove';

function getMutationHook() {
  return trpc.ai.improveMessage.useMutation as unknown as ReturnType<typeof vi.fn>;
}

describe('useComposeAiImprove', () => {
  let mutateAsync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getMutationHook().mockReset();
    mutateAsync = vi.fn();
    getMutationHook().mockReturnValue({ mutateAsync });
  });

  describe('handleImprove', () => {
    it('captures original text, calls mutateAsync with trimmed text + role, replaces text with improved', async () => {
      mutateAsync.mockResolvedValue({ improved: 'Polished reply.' });
      const setText = vi.fn();
      const doSend = vi.fn();

      const { result } = renderHook(() =>
        useComposeAiImprove({
          text: '  original draft text  ',
          setText,
          isSupport: true,
          aiConfig: { messageImprovement: 'optional' },
          doSend,
        }),
      );

      await act(async () => {
        await result.current.handleImprove();
      });

      expect(mutateAsync).toHaveBeenCalledWith({
        text: 'original draft text',
        role: 'support',
      });
      expect(setText).toHaveBeenCalledWith('Polished reply.');
      expect(result.current.originalText).toBe('  original draft text  ');
      expect(result.current.improving).toBe(false);
    });

    it('is a no-op when improving=true or text is under 10 chars', async () => {
      mutateAsync.mockResolvedValue({ improved: 'x' });
      const setText = vi.fn();

      const { result } = renderHook(() =>
        useComposeAiImprove({
          text: 'short',
          setText,
          isSupport: false,
          aiConfig: { messageImprovement: 'optional' },
          doSend: vi.fn(),
        }),
      );

      await act(async () => {
        await result.current.handleImprove();
      });

      expect(mutateAsync).not.toHaveBeenCalled();
      expect(setText).not.toHaveBeenCalled();
      expect(result.current.originalText).toBeNull();
    });

    it('uses role=agent when isSupport=false', async () => {
      mutateAsync.mockResolvedValue({ improved: 'ok' });
      const { result } = renderHook(() =>
        useComposeAiImprove({
          text: 'long enough text here',
          setText: vi.fn(),
          isSupport: false,
          aiConfig: { messageImprovement: 'optional' },
          doSend: vi.fn(),
        }),
      );

      await act(async () => {
        await result.current.handleImprove();
      });

      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'agent' }),
      );
    });

    it('clears originalText and keeps text untouched on mutation error', async () => {
      mutateAsync.mockRejectedValue(new Error('ai down'));
      const setText = vi.fn();

      const { result } = renderHook(() =>
        useComposeAiImprove({
          text: 'long enough text here',
          setText,
          isSupport: true,
          aiConfig: { messageImprovement: 'optional' },
          doSend: vi.fn(),
        }),
      );

      await act(async () => {
        await result.current.handleImprove();
      });

      expect(setText).not.toHaveBeenCalled();
      expect(result.current.originalText).toBeNull();
      expect(result.current.improving).toBe(false);
    });
  });

  describe('revertImprove', () => {
    it('restores the exact pre-improve text (including whitespace) and clears originalText', async () => {
      mutateAsync.mockResolvedValue({ improved: 'Tidy version.' });
      const setText = vi.fn();

      const { result } = renderHook(() =>
        useComposeAiImprove({
          text: '  keep this **exact** draft  ',
          setText,
          isSupport: true,
          aiConfig: { messageImprovement: 'optional' },
          doSend: vi.fn(),
        }),
      );

      await act(async () => {
        await result.current.handleImprove();
      });
      setText.mockClear();

      act(() => {
        result.current.revertImprove();
      });

      expect(setText).toHaveBeenCalledWith('  keep this **exact** draft  ');
      expect(result.current.originalText).toBeNull();
    });

    it('is a no-op when originalText is null', () => {
      const setText = vi.fn();
      const { result } = renderHook(() =>
        useComposeAiImprove({
          text: 'whatever',
          setText,
          isSupport: true,
          aiConfig: null,
          doSend: vi.fn(),
        }),
      );

      act(() => {
        result.current.revertImprove();
      });

      expect(setText).not.toHaveBeenCalled();
    });
  });

  describe('improveAndSend (forced mode)', () => {
    it('awaits the mutation, then calls doSend with the improved text', async () => {
      let resolveMutation: (value: { improved: string }) => void = () => {};
      mutateAsync.mockReturnValue(
        new Promise<{ improved: string }>((resolve) => {
          resolveMutation = resolve;
        }),
      );
      const doSend = vi.fn();

      const { result } = renderHook(() =>
        useComposeAiImprove({
          text: 'please improve and send this',
          setText: vi.fn(),
          isSupport: true,
          aiConfig: { messageImprovement: 'forced' },
          doSend,
        }),
      );

      let improvePromise!: Promise<void>;
      act(() => {
        improvePromise = result.current.improveAndSend();
      });

      // Mutation pending, doSend must not have fired yet.
      expect(doSend).not.toHaveBeenCalled();
      expect(result.current.improving).toBe(true);

      await act(async () => {
        resolveMutation({ improved: 'Improved send target.' });
        await improvePromise;
      });

      expect(doSend).toHaveBeenCalledTimes(1);
      expect(doSend).toHaveBeenCalledWith('Improved send target.');
      expect(result.current.improving).toBe(false);
    });

    it('falls through to doSend with the original trimmed text when the mutation throws', async () => {
      mutateAsync.mockRejectedValue(new Error('boom'));
      const doSend = vi.fn();

      const { result } = renderHook(() =>
        useComposeAiImprove({
          text: '  please improve and send  ',
          setText: vi.fn(),
          isSupport: true,
          aiConfig: { messageImprovement: 'forced' },
          doSend,
        }),
      );

      await act(async () => {
        await result.current.improveAndSend();
      });

      expect(doSend).toHaveBeenCalledTimes(1);
      expect(doSend).toHaveBeenCalledWith('please improve and send');
      expect(result.current.improving).toBe(false);
    });

    it('skips improve and calls doSend directly when text is under 10 chars', async () => {
      const doSend = vi.fn();

      const { result } = renderHook(() =>
        useComposeAiImprove({
          text: '  hi  ',
          setText: vi.fn(),
          isSupport: true,
          aiConfig: { messageImprovement: 'forced' },
          doSend,
        }),
      );

      await act(async () => {
        await result.current.improveAndSend();
      });

      expect(mutateAsync).not.toHaveBeenCalled();
      expect(doSend).toHaveBeenCalledWith('hi');
    });

    it('skips improve when originalText is already set (already improved)', async () => {
      mutateAsync.mockResolvedValue({ improved: 'improved' });
      const doSend = vi.fn();

      const { result } = renderHook(() =>
        useComposeAiImprove({
          text: 'long enough improved content',
          setText: vi.fn(),
          isSupport: true,
          aiConfig: { messageImprovement: 'forced' },
          doSend,
        }),
      );

      // Prime: first improve sets originalText
      await act(async () => {
        await result.current.handleImprove();
      });
      mutateAsync.mockClear();
      doSend.mockClear();

      await act(async () => {
        await result.current.improveAndSend();
      });

      expect(mutateAsync).not.toHaveBeenCalled();
      expect(doSend).toHaveBeenCalledWith('long enough improved content');
    });

    it('refuses to double-fire while a prior improveAndSend is still in flight', async () => {
      let resolveMutation: (value: { improved: string }) => void = () => {};
      mutateAsync.mockReturnValue(
        new Promise<{ improved: string }>((resolve) => {
          resolveMutation = resolve;
        }),
      );
      const doSend = vi.fn();

      const { result } = renderHook(() =>
        useComposeAiImprove({
          text: 'please improve and send this',
          setText: vi.fn(),
          isSupport: true,
          aiConfig: { messageImprovement: 'forced' },
          doSend,
        }),
      );

      let firstCall!: Promise<void>;
      act(() => {
        firstCall = result.current.improveAndSend();
      });

      let secondCall!: Promise<void>;
      act(() => {
        secondCall = result.current.improveAndSend();
      });

      await act(async () => {
        resolveMutation({ improved: 'once' });
        await Promise.all([firstCall, secondCall]);
      });

      expect(mutateAsync).toHaveBeenCalledTimes(1);
      expect(doSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('reset', () => {
    it('clears originalText — used by parent after successful send', async () => {
      mutateAsync.mockResolvedValue({ improved: 'tidy' });
      const { result } = renderHook(() =>
        useComposeAiImprove({
          text: 'long enough text here',
          setText: vi.fn(),
          isSupport: true,
          aiConfig: { messageImprovement: 'optional' },
          doSend: vi.fn(),
        }),
      );
      await act(async () => {
        await result.current.handleImprove();
      });
      expect(result.current.originalText).not.toBeNull();

      act(() => {
        result.current.reset();
      });

      expect(result.current.originalText).toBeNull();
    });
  });

  describe('improvementMode passthrough', () => {
    it('returns off when aiConfig is null', () => {
      const { result } = renderHook(() =>
        useComposeAiImprove({
          text: '',
          setText: vi.fn(),
          isSupport: false,
          aiConfig: null,
          doSend: vi.fn(),
        }),
      );
      expect(result.current.improvementMode).toBe('off');
    });

    it('returns the configured mode when aiConfig.messageImprovement is set', () => {
      const { result } = renderHook(() =>
        useComposeAiImprove({
          text: '',
          setText: vi.fn(),
          isSupport: false,
          aiConfig: { messageImprovement: 'forced' },
          doSend: vi.fn(),
        }),
      );
      expect(result.current.improvementMode).toBe('forced');
    });
  });
});

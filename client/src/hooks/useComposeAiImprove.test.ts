import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../utils/trpc', () => ({
  trpc: {
    ai: {
      improveMessage: {
        useMutation: vi.fn(),
      },
      markImproveResult: {
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

function getMarkResultHook() {
  return trpc.ai.markImproveResult.useMutation as unknown as ReturnType<typeof vi.fn>;
}

describe('useComposeAiImprove', () => {
  let mutateAsync: ReturnType<typeof vi.fn>;
  let markMutateAsync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getMutationHook().mockReset();
    getMarkResultHook().mockReset();
    mutateAsync = vi.fn();
    markMutateAsync = vi.fn().mockResolvedValue({ ok: true });
    getMutationHook().mockReturnValue({ mutateAsync });
    getMarkResultHook().mockReturnValue({ mutateAsync: markMutateAsync });
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
    it('awaits the mutation, then sets pendingImprove (does NOT call doSend immediately)', async () => {
      let resolveMutation: (value: { improved: string; usageLogId: string | null }) => void = () => {};
      mutateAsync.mockReturnValue(
        new Promise<{ improved: string; usageLogId: string | null }>((resolve) => {
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
        resolveMutation({ improved: 'Improved send target.', usageLogId: 'log_abc' });
        await improvePromise;
      });

      // doSend STILL not called — the modal will trigger the actual send.
      expect(doSend).not.toHaveBeenCalled();
      expect(result.current.improving).toBe(false);
      expect(result.current.pendingImprove).toEqual({
        original: 'please improve and send this',
        improved: 'Improved send target.',
        usageLogId: 'log_abc',
      });
    });

    it('captures null usageLogId when the mutation returns null (server log write failed)', async () => {
      mutateAsync.mockResolvedValue({ improved: 'tidy', usageLogId: null });
      const doSend = vi.fn();
      const { result } = renderHook(() =>
        useComposeAiImprove({
          text: 'please improve and send',
          setText: vi.fn(),
          isSupport: true,
          aiConfig: { messageImprovement: 'forced' },
          doSend,
        }),
      );

      await act(async () => {
        await result.current.improveAndSend();
      });

      expect(result.current.pendingImprove).toEqual({
        original: 'please improve and send',
        improved: 'tidy',
        usageLogId: null,
      });
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

      // On failure, nothing to diff — fall back to immediate send.
      expect(doSend).toHaveBeenCalledTimes(1);
      expect(doSend).toHaveBeenCalledWith('please improve and send');
      expect(result.current.improving).toBe(false);
      expect(result.current.pendingImprove).toBeNull();
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
      mutateAsync.mockResolvedValue({ improved: 'improved', usageLogId: 'log_x' });
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
      let resolveMutation: (value: { improved: string; usageLogId: string | null }) => void = () => {};
      mutateAsync.mockReturnValue(
        new Promise<{ improved: string; usageLogId: string | null }>((resolve) => {
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
        resolveMutation({ improved: 'once', usageLogId: 'log_y' });
        await Promise.all([firstCall, secondCall]);
      });

      expect(mutateAsync).toHaveBeenCalledTimes(1);
      // Modal not yet confirmed — doSend still hasn't fired.
      expect(doSend).not.toHaveBeenCalled();
    });
  });

  describe('confirmSendImproved / confirmSendOriginal / dismissImprove (forced-mode modal)', () => {
    async function primeForcedImprove(opts: {
      text: string;
      doSend: ReturnType<typeof vi.fn>;
      improved: string;
      usageLogId: string | null;
    }) {
      mutateAsync.mockResolvedValue({ improved: opts.improved, usageLogId: opts.usageLogId });
      const hook = renderHook(() =>
        useComposeAiImprove({
          text: opts.text,
          setText: vi.fn(),
          isSupport: true,
          aiConfig: { messageImprovement: 'forced' },
          doSend: opts.doSend as unknown as (finalText: string, opts?: { improvedFromUsageLogId?: string }) => void,
        }),
      );
      await act(async () => {
        await hook.result.current.improveAndSend();
      });
      return hook;
    }

    it('confirmSendImproved calls doSend with improvedFromUsageLogId then clears pendingImprove', async () => {
      const doSend = vi.fn();
      const { result } = await primeForcedImprove({
        text: 'please polish and send this',
        doSend,
        improved: 'Polished version.',
        usageLogId: 'log_42',
      });

      expect(result.current.pendingImprove).not.toBeNull();

      await act(async () => {
        await result.current.confirmSendImproved();
      });

      expect(doSend).toHaveBeenCalledTimes(1);
      expect(doSend).toHaveBeenCalledWith('Polished version.', { improvedFromUsageLogId: 'log_42' });
      expect(result.current.pendingImprove).toBeNull();
      // markImproveResult should NOT be called for the "improved" path —
      // sentOriginal=false is implicit in that the server stamped improved_at.
      expect(markMutateAsync).not.toHaveBeenCalled();
    });

    it('confirmSendOriginal calls doSend without improvedFromUsageLogId AND markImproveResult(sentOriginal=true)', async () => {
      const doSend = vi.fn();
      const { result } = await primeForcedImprove({
        text: 'please polish and send this',
        doSend,
        improved: 'Polished version.',
        usageLogId: 'log_77',
      });

      await act(async () => {
        await result.current.confirmSendOriginal();
      });

      expect(doSend).toHaveBeenCalledTimes(1);
      expect(doSend).toHaveBeenCalledWith('please polish and send this');
      // Should NOT pass improvedFromUsageLogId.
      expect(doSend.mock.calls[0][1]).toBeUndefined();
      expect(markMutateAsync).toHaveBeenCalledWith({
        usageLogId: 'log_77',
        sentOriginal: true,
      });
      expect(result.current.pendingImprove).toBeNull();
    });

    it('confirmSendOriginal swallows errors from markImproveResult — implicit feedback must not break send', async () => {
      markMutateAsync.mockRejectedValueOnce(new Error('log write down'));
      const doSend = vi.fn();
      const { result } = await primeForcedImprove({
        text: 'please polish and send this',
        doSend,
        improved: 'Polished version.',
        usageLogId: 'log_99',
      });

      await act(async () => {
        await result.current.confirmSendOriginal();
      });

      // Send still happened, modal still cleared — failure was non-fatal.
      expect(doSend).toHaveBeenCalledWith('please polish and send this');
      expect(result.current.pendingImprove).toBeNull();
    });

    it('confirmSendOriginal skips markImproveResult when usageLogId is null', async () => {
      const doSend = vi.fn();
      const { result } = await primeForcedImprove({
        text: 'please polish and send this',
        doSend,
        improved: 'Polished version.',
        usageLogId: null,
      });

      await act(async () => {
        await result.current.confirmSendOriginal();
      });

      expect(doSend).toHaveBeenCalledWith('please polish and send this');
      expect(markMutateAsync).not.toHaveBeenCalled();
      expect(result.current.pendingImprove).toBeNull();
    });

    it('dismissImprove clears pendingImprove without sending', async () => {
      const doSend = vi.fn();
      const { result } = await primeForcedImprove({
        text: 'please polish and send this',
        doSend,
        improved: 'Polished version.',
        usageLogId: 'log_zz',
      });

      act(() => {
        result.current.dismissImprove();
      });

      expect(doSend).not.toHaveBeenCalled();
      expect(markMutateAsync).not.toHaveBeenCalled();
      expect(result.current.pendingImprove).toBeNull();
    });
  });

  describe('lastUsageLogId (optional mode tracking)', () => {
    it('captures lastUsageLogId when handleImprove resolves', async () => {
      mutateAsync.mockResolvedValue({ improved: 'tidy', usageLogId: 'log_opt' });
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

      expect(result.current.lastUsageLogId).toBe('log_opt');
    });

    it('clears lastUsageLogId on revert', async () => {
      mutateAsync.mockResolvedValue({ improved: 'tidy', usageLogId: 'log_rev' });
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
      expect(result.current.lastUsageLogId).toBe('log_rev');

      act(() => {
        result.current.revertImprove();
      });

      expect(result.current.lastUsageLogId).toBeNull();
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

import { useCallback, useRef, useState } from 'react';
import { trpc } from '../utils/trpc';

const MIN_IMPROVE_LEN = 10;

interface AiConfigLike {
  messageImprovement?: string;
  [key: string]: unknown;
}

interface UseComposeAiImproveParams {
  text: string;
  setText: (value: string) => void;
  isSupport: boolean;
  aiConfig?: AiConfigLike | null;
  /**
   * Send-callback. Slice 7 added the optional second arg so the forced-mode
   * modal can stamp the message with the originating `usageLogId` — the
   * server uses that to set `messages.improved_at` and the ✨ AI badge
   * renders. Optional path leaves `opts` undefined.
   */
  doSend: (finalText: string, opts?: { improvedFromUsageLogId?: string }) => void | Promise<void>;
}

export interface PendingImprove {
  original: string;
  improved: string;
  usageLogId: string | null;
}

export interface UseComposeAiImproveResult {
  originalText: string | null;
  improving: boolean;
  improvementMode: string;
  handleImprove: () => Promise<void>;
  revertImprove: () => void;
  /**
   * Forced-mode entry point. Runs the improve mutation, then sets
   * `pendingImprove` so the parent can render the diff modal. Confirming
   * the modal calls `confirmSendImproved` / `confirmSendOriginal` which
   * actually invoke `doSend`. If the mutation throws, falls back to an
   * immediate send of the original text (no modal — nothing to diff).
   */
  improveAndSend: () => Promise<void>;
  reset: () => void;
  /** Pending forced-mode improve awaiting user confirmation. */
  pendingImprove: PendingImprove | null;
  /** Send the improved text + stamp it via `improvedFromUsageLogId`. */
  confirmSendImproved: () => Promise<void>;
  /**
   * Send the original text. Records `sentOriginal=true` on the usage log
   * row (implicit feedback per Decision 30). Errors from the log mutation
   * are swallowed — implicit-feedback failure must not break the send.
   */
  confirmSendOriginal: () => Promise<void>;
  /** Close the modal without sending. No log mutation. */
  dismissImprove: () => void;
  /**
   * Most recent improveMessage usageLogId (optional-mode signal). Cleared
   * by `revertImprove` and `reset`. Drives any future surface that wants
   * to record explicit feedback against the optional-mode result.
   */
  lastUsageLogId: string | null;
}

/**
 * AI message-improvement lifecycle: capture original, run mutation, swap text,
 * expose revert, and the forced-mode improve→diff-modal→send sequencer. Hook
 * writes only to `setText` — parent's setContent effect keeps the Tiptap
 * editor in sync.
 */
export function useComposeAiImprove({
  text,
  setText,
  isSupport,
  aiConfig,
  doSend,
}: UseComposeAiImproveParams): UseComposeAiImproveResult {
  const [originalText, setOriginalText] = useState<string | null>(null);
  const [improving, setImproving] = useState(false);
  const [pendingImprove, setPendingImprove] = useState<PendingImprove | null>(null);
  const [lastUsageLogId, setLastUsageLogId] = useState<string | null>(null);
  const improvingRef = useRef(false);
  const improveMutation = trpc.ai.improveMessage.useMutation();
  const markResultMutation = trpc.ai.markImproveResult.useMutation();

  const improvementMode = aiConfig?.messageImprovement ?? 'off';

  const handleImprove = useCallback(async () => {
    if (improvingRef.current || text.trim().length < MIN_IMPROVE_LEN) return;
    improvingRef.current = true;
    setImproving(true);
    setOriginalText(text);
    try {
      const result = await improveMutation.mutateAsync({
        text: text.trim(),
        role: isSupport ? 'support' : 'agent',
      });
      setText(result.improved);
      setLastUsageLogId(result.usageLogId ?? null);
    } catch {
      setOriginalText(null);
    } finally {
      improvingRef.current = false;
      setImproving(false);
    }
  }, [text, isSupport, setText, improveMutation]);

  const revertImprove = useCallback(() => {
    setOriginalText((prev) => {
      if (prev === null) return prev;
      setText(prev);
      return null;
    });
    setLastUsageLogId(null);
  }, [setText]);

  const improveAndSend = useCallback(async () => {
    if (improvingRef.current) return;
    const trimmed = text.trim();
    if (trimmed.length >= MIN_IMPROVE_LEN && originalText === null) {
      improvingRef.current = true;
      setImproving(true);
      try {
        const result = await improveMutation.mutateAsync({
          text: trimmed,
          role: isSupport ? 'support' : 'agent',
        });
        // Forced-mode now opens the diff modal instead of sending. The
        // modal triggers the actual `doSend` via confirmSend* below.
        setPendingImprove({
          original: trimmed,
          improved: result.improved,
          usageLogId: result.usageLogId ?? null,
        });
      } catch {
        // Mutation failed — nothing to diff. Fall back to immediate send
        // so the user's message still goes through (preserves prior
        // behaviour for partner with flaky AI provider).
        await doSend(trimmed);
      } finally {
        improvingRef.current = false;
        setImproving(false);
      }
    } else {
      await doSend(trimmed);
    }
  }, [text, originalText, isSupport, doSend, improveMutation]);

  const confirmSendImproved = useCallback(async () => {
    if (!pendingImprove) return;
    const opts = pendingImprove.usageLogId
      ? { improvedFromUsageLogId: pendingImprove.usageLogId }
      : undefined;
    setPendingImprove(null);
    setOriginalText(null);
    setLastUsageLogId(null);
    await Promise.resolve(doSend(pendingImprove.improved, opts));
  }, [doSend, pendingImprove]);

  const confirmSendOriginal = useCallback(async () => {
    if (!pendingImprove) return;
    const captured = pendingImprove;
    setPendingImprove(null);
    setOriginalText(null);
    setLastUsageLogId(null);
    await Promise.resolve(doSend(captured.original));
    if (captured.usageLogId) {
      try {
        await markResultMutation.mutateAsync({
          usageLogId: captured.usageLogId,
          sentOriginal: true,
        });
      } catch {
        // Implicit-feedback failure must not break the send. Swallow.
      }
    }
  }, [doSend, markResultMutation, pendingImprove]);

  const dismissImprove = useCallback(() => {
    setPendingImprove(null);
  }, []);

  const reset = useCallback(() => {
    setOriginalText(null);
    setLastUsageLogId(null);
  }, []);

  return {
    originalText,
    improving,
    improvementMode,
    handleImprove,
    revertImprove,
    improveAndSend,
    reset,
    pendingImprove,
    confirmSendImproved,
    confirmSendOriginal,
    dismissImprove,
    lastUsageLogId,
  };
}

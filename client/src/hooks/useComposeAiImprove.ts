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
  doSend: (finalText: string) => void | Promise<void>;
}

interface UseComposeAiImproveResult {
  originalText: string | null;
  improving: boolean;
  improvementMode: string;
  handleImprove: () => Promise<void>;
  revertImprove: () => void;
  improveAndSend: () => Promise<void>;
  reset: () => void;
}

/**
 * AI message-improvement lifecycle: capture original, run mutation, swap text,
 * expose revert, and the forced-mode improve→send sequencer. Hook writes only
 * to `setText` — parent's setContent effect keeps the Tiptap editor in sync.
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
  const improvingRef = useRef(false);
  const improveMutation = trpc.ai.improveMessage.useMutation();

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
        await doSend(result.improved);
      } catch {
        await doSend(trimmed);
      } finally {
        improvingRef.current = false;
        setImproving(false);
      }
    } else {
      await doSend(trimmed);
    }
  }, [text, originalText, isSupport, doSend, improveMutation]);

  const reset = useCallback(() => {
    setOriginalText(null);
  }, []);

  return {
    originalText,
    improving,
    improvementMode,
    handleImprove,
    revertImprove,
    improveAndSend,
    reset,
  };
}

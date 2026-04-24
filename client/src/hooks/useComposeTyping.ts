import { useCallback, useEffect, useRef } from 'react';
import { getSocket } from './useSocket';
import type { Ticket } from '../types';

const IDLE_STOP_MS = 2000;

interface UseComposeTypingParams {
  ticket: Ticket;
  whisperMode: boolean;
}

interface UseComposeTypingResult {
  emit: () => void;
  stop: () => void;
}

/**
 * Socket typing indicator with 2s idle auto-stop. `emit()` from onUpdate,
 * `stop()` on send/clear. Unmount flushes a bare `typing:stop` (no whisper
 * flag) to guarantee the server drops any phantom indicator.
 */
export function useComposeTyping({
  ticket,
  whisperMode,
}: UseComposeTypingParams): UseComposeTypingResult {
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const ticketId = ticket.id;

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (isTypingRef.current) {
        isTypingRef.current = false;
        const socket = getSocket();
        if (socket) socket.emit('typing:stop', { ticketId });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = useCallback(() => {
    const socket = getSocket();
    if (!socket) return;
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      socket.emit('typing:start', { ticketId, whisper: whisperMode });
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      const s = getSocket();
      if (s) s.emit('typing:stop', { ticketId, whisper: whisperMode });
    }, IDLE_STOP_MS);
  }, [ticketId, whisperMode]);

  const stop = useCallback(() => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      const socket = getSocket();
      if (socket) socket.emit('typing:stop', { ticketId, whisper: whisperMode });
    }
  }, [ticketId, whisperMode]);

  return { emit, stop };
}

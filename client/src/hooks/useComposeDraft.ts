import { useEffect } from 'react';
import type { User } from '../types';

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const DRAFT_KEY_PREFIX = 'guichet:draft:';

// Purge expired drafts once per session (module load). Drafts older than 24h
// are stale — the ticket is likely closed or reassigned.
(() => {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(DRAFT_KEY_PREFIX));
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const { ts } = JSON.parse(raw);
        if (!ts || Date.now() - ts > DRAFT_TTL_MS) localStorage.removeItem(key);
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* localStorage unavailable */
  }
})();

interface UseComposeDraftParams {
  user: User | null;
  ticketId: string;
  whisperMode: boolean;
  text: string;
  setText: (value: string) => void;
}

/**
 * Persists the compose buffer to localStorage per (user, ticket, whisperMode).
 * Hydrates on key change and debounces saves at 400ms after the last keystroke.
 * The hook writes only to `setText` — parent's existing setContent effect
 * pushes the hydrated value into the Tiptap editor.
 */
export function useComposeDraft({
  user,
  ticketId,
  whisperMode,
  text,
  setText,
}: UseComposeDraftParams): void {
  const draftKey = `${DRAFT_KEY_PREFIX}${user?.id || 'anon'}:${ticketId}:${whisperMode ? 'whisper' : 'regular'}`;

  useEffect(() => {
    const raw = localStorage.getItem(draftKey);
    if (raw) {
      try {
        const { text: saved, ts } = JSON.parse(raw);
        if (Date.now() - ts < DRAFT_TTL_MS) {
          setText(saved);
          return;
        }
        localStorage.removeItem(draftKey);
      } catch {
        localStorage.removeItem(draftKey);
      }
    }
    setText('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (text) localStorage.setItem(draftKey, JSON.stringify({ text, ts: Date.now() }));
      else localStorage.removeItem(draftKey);
    }, 400);
    return () => clearTimeout(timer);
  }, [text, draftKey]);
}

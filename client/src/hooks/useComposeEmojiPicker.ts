import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Editor } from '@tiptap/react';

interface UseComposeEmojiPickerParams {
  /** Latest-editor ref. Parent populates after `useComposeEditor` returns.
   *  A ref (not a direct value) lets this hook be declared BEFORE
   *  `useComposeEditor` so the editor's onUpdate/onSubmit/onEscape closures
   *  can reference `syncQuery` / `query` / `clearQuery` without a TDZ. */
  editorRef: RefObject<Editor | null>;
  text: string;
  setText: (value: string) => void;
}

interface UseComposeEmojiPickerResult {
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
  pickerRef: RefObject<HTMLDivElement | null>;
  gridRef: RefObject<HTMLDivElement | null>;
  position: { bottom: number; left: number } | null;
  insert: (emoji: string) => void;

  query: string | null;
  syncQuery: (markdown: string) => void;
  clearQuery: () => void;
  selectSuggestion: (emoji: string) => void;
}

const EMOJI_QUERY_RE = /:(\w{2,})$/;

/**
 * Compose-area emoji UX: Smile-button picker (portaled grid) + `:query`
 * inline suggestions. Owns popup open state, fixed-position anchoring,
 * outside-click close, and the `:word` trigger regex. Never calls
 * `editor.commands.setContent` — suggestions go through `setText` (parent's
 * setContent effect syncs the editor), picker-grid insert uses
 * `editor.chain().insertContent()` at cursor, and `focus()` is safe because
 * it doesn't mutate content.
 */
export function useComposeEmojiPicker({
  editorRef,
  text,
  setText,
}: UseComposeEmojiPickerParams): UseComposeEmojiPickerResult {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [position, setPosition] = useState<{ bottom: number; left: number } | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const toggle = useCallback(() => setIsOpen((v) => !v), []);
  const close = useCallback(() => setIsOpen(false), []);

  // Outside-click close. Grid is portaled to document.body, so both the
  // trigger-wrapper and grid refs need to be excluded.
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (pickerRef.current?.contains(target)) return;
      if (gridRef.current?.contains(target)) return;
      setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Anchor fixed-position coords to the trigger wrapper's rect so the
  // portaled grid escapes any overflow-hidden clip on the compose box.
  useLayoutEffect(() => {
    if (!isOpen) return;
    function compute() {
      const el = pickerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const GAP = 8;
      setPosition({
        bottom: window.innerHeight - r.top + GAP,
        left: r.left,
      });
    }
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [isOpen]);

  const insert = useCallback(
    (emoji: string) => {
      editorRef.current?.chain().focus().insertContent(emoji).run();
      setIsOpen(false);
    },
    [editorRef],
  );

  const syncQuery = useCallback((markdown: string) => {
    const m = markdown.match(EMOJI_QUERY_RE);
    setQuery(m ? m[1] : null);
  }, []);

  const clearQuery = useCallback(() => setQuery(null), []);

  const selectSuggestion = useCallback(
    (emoji: string) => {
      const newText = text.replace(EMOJI_QUERY_RE, emoji);
      setText(newText);
      setQuery(null);
      editorRef.current?.chain().focus().run();
    },
    [text, setText, editorRef],
  );

  return {
    isOpen,
    toggle,
    close,
    pickerRef,
    gridRef,
    position,
    insert,
    query,
    syncQuery,
    clearQuery,
    selectSuggestion,
  };
}

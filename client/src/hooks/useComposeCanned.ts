import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { Editor } from '@tiptap/react';

interface UseComposeCannedParams {
  /** Latest-editor ref. Same pattern as useComposeEmojiPicker: a ref lets
   *  this hook be declared BEFORE useComposeEditor so the editor's
   *  onUpdate/onEscape closures can reference `syncFromMarkdown` / `isOpen` /
   *  `close` without a TDZ. */
  editorRef: RefObject<Editor | null>;
  setText: (value: string) => void;
  isSupport: boolean;
}

interface UseComposeCannedResult {
  isOpen: boolean;
  close: () => void;
  syncFromMarkdown: (markdown: string) => void;
  insert: (body: string) => void;
}

const OPEN_CANNED_EVENT = 'support:open-canned-picker';

/**
 * Canned-response picker UX: opens when the compose buffer starts with
 * `/` (support role only), opens on the global
 * `support:open-canned-picker` window event (Alt+J from SupportView), and
 * inserts the selected body at cursor. Insert writes through `setText`
 * only — parent's setContent effect pushes the new value into the editor.
 * `editor.commands.focus()` is safe (no content mutation).
 */
export function useComposeCanned({
  editorRef,
  setText,
  isSupport,
}: UseComposeCannedParams): UseComposeCannedResult {
  const [isOpen, setIsOpen] = useState(false);

  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    function open() {
      setIsOpen(true);
    }
    window.addEventListener(OPEN_CANNED_EVENT, open);
    return () => window.removeEventListener(OPEN_CANNED_EVENT, open);
  }, []);

  const syncFromMarkdown = useCallback(
    (markdown: string) => {
      if (!isSupport) return;
      if (markdown.startsWith('/')) {
        setIsOpen(true);
      } else {
        setIsOpen((prev) => (prev ? false : prev));
      }
    },
    [isSupport],
  );

  const insert = useCallback(
    (body: string) => {
      setText(body);
      setIsOpen(false);
      editorRef.current?.chain().focus().run();
    },
    [setText, editorRef],
  );

  return { isOpen, close, syncFromMarkdown, insert };
}

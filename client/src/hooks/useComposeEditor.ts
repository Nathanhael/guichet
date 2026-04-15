import { useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { Markdown } from 'tiptap-markdown';

const MAX_MESSAGE_CHARS = 5000;

/** Shape that tiptap-markdown contributes to editor.storage. If the
 *  upstream extension ever renames its storage key, the guarded access
 *  below returns undefined and we fall back to editor.getText() instead
 *  of silently returning the wrong type. */
interface EditorStorageWithMarkdown {
  markdown?: { getMarkdown(): string };
}

interface UseComposeEditorArgs {
  /** Placeholder text shown when the editor is empty. */
  placeholder: string;
  /** Called on every keystroke with the serialized markdown. */
  onUpdate?: (markdown: string) => void;
  /** Called when the user presses Enter (without Shift/Ctrl/Meta). */
  onSubmit?: () => void;
  /** Called when the user presses Escape. */
  onEscape?: () => void;
  /** Called when the editor receives a native paste event. */
  onPaste?: (event: ClipboardEvent) => boolean | void;
  /** Called when the editor receives a native drop event. */
  onDrop?: (event: DragEvent) => boolean | void;
}

/**
 * Guichet compose editor — a Tiptap instance pre-configured with the
 * brutalist chat subset: Bold, Italic, Strike, Code, Blockquote,
 * BulletList. No headings, no horizontal rules, no code blocks, no
 * ordered lists. Input rules are on so typing `**bold**` still
 * auto-converts to bold (markdown muscle memory preserved).
 *
 * `onUpdate` receives the canonical markdown string via the
 * `tiptap-markdown` serializer — the caller never has to touch Tiptap's
 * JSON document shape. That markdown is what gets persisted to drafts,
 * what gets shipped to the server on send, and what existing code
 * paths already expect.
 */
export function useComposeEditor({
  placeholder,
  onUpdate,
  onSubmit,
  onEscape,
  onPaste,
  onDrop,
}: UseComposeEditorArgs): Editor | null {
  return useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
        codeBlock: false,
        orderedList: false,
      }),
      Placeholder.configure({ placeholder }),
      CharacterCount.configure({ limit: MAX_MESSAGE_CHARS }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        bulletListMarker: '-',
        linkify: true,
      }),
    ],
    content: '',
    autofocus: false,
    editorProps: {
      attributes: {
        // Tailwind classes applied to the ProseMirror-editable region.
        // Keep it borderless — the outer compose box supplies the border.
        class: 'outline-none min-h-[42px] max-h-60 overflow-y-auto py-3 px-2 text-[15px] text-text-primary leading-snug break-words whitespace-pre-wrap',
        'aria-label': 'Type a message',
      },
      handleKeyDown(_view, event) {
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          onSubmit?.();
          return true;
        }
        if (event.key === 'Escape') {
          if (onEscape) {
            onEscape();
            return true;
          }
        }
        return false;
      },
      handlePaste(_view, event) {
        // Give the caller first crack at the paste event (e.g. to pull
        // images off the clipboard). If they return true, they consumed
        // it and Tiptap should stop processing.
        if (onPaste) {
          const handled = onPaste(event as ClipboardEvent);
          if (handled) return true;
        }
        return false;
      },
      handleDrop(_view, event) {
        if (onDrop) {
          const handled = onDrop(event as DragEvent);
          if (handled) return true;
        }
        return false;
      },
    },
    onUpdate({ editor }) {
      if (!onUpdate) return;
      // tiptap-markdown exposes getMarkdown() via editor.storage.markdown.
      // Guarded access: if the storage key ever changes, fall back to
      // plain text instead of crashing.
      const storage = editor.storage as unknown as EditorStorageWithMarkdown;
      const md = storage.markdown?.getMarkdown() ?? editor.getText();
      onUpdate(md);
    },
  });
}

/** Convenience helper used by consumers that need the current markdown
 *  outside of the onUpdate callback (e.g. inside an event handler). */
export function getEditorMarkdown(editor: Editor | null): string {
  if (!editor) return '';
  const storage = editor.storage as unknown as EditorStorageWithMarkdown;
  return storage.markdown?.getMarkdown() ?? editor.getText();
}

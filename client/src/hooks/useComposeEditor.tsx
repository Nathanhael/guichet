import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type FC,
} from 'react';
import { createPortal } from 'react-dom';
import { useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { Markdown } from 'tiptap-markdown';
import { getSocket } from './useSocket';
import EmojiSuggestion from '../components/chat/EmojiSuggestion';
import CannedResponsePicker from '../components/CannedResponsePicker';
import { EMOJI_LIST } from '../utils/emojiData';
import type { Ticket, User } from '../types';

const MAX_MESSAGE_CHARS = 5000;
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const DRAFT_KEY_PREFIX = 'guichet:draft:';
const DRAFT_DEBOUNCE_MS = 400;
const TYPING_IDLE_MS = 2000;
const EMOJI_QUERY_RE = /:(\w{2,})$/;
const OPEN_CANNED_EVENT = 'support:open-canned-picker';
const EMOJI_GRID_GAP_PX = 8;

interface EditorStorageWithMarkdown {
  markdown?: { getMarkdown(): string };
}

function readMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as EditorStorageWithMarkdown;
  return storage.markdown?.getMarkdown() ?? editor.getText();
}

// Module-load TTL purge — drafts older than 24h are stale (ticket likely
// closed or reassigned) and shouldn't pop up when the agent reopens it.
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

export interface ComposeEditorOptions {
  ticket: Ticket;
  user: User | null;
  whisperMode: boolean;
  isSupport: boolean;
  placeholder: string;
  onSubmit: () => void;
  onPaste?: (event: ClipboardEvent) => boolean | void;
  onDrop?: (event: DragEvent) => boolean | void;
  onError?: (err: { code: string; detail?: string }) => void;
  onEscape?: () => void;
}

export interface ComposeEditorHandle {
  editor: Editor | null;
  text: string;
  replaceText: (next: string) => void;
  PickerPortals: FC;
  clear: () => void;
  focus: () => void;
  isDraftLoaded: boolean;
  emojiAnchorRef: RefObject<HTMLDivElement | null>;
  toggleEmojiGrid: () => void;
  isEmojiGridOpen: boolean;
}

export function useComposeEditor(opts: ComposeEditorOptions): ComposeEditorHandle {
  const { ticket, user, whisperMode, isSupport, placeholder } = opts;
  const ticketId = ticket.id;
  const [text, setText] = useState('');
  const [isDraftLoaded, setIsDraftLoaded] = useState(false);
  const [emojiQuery, setEmojiQuery] = useState<string | null>(null);
  const [cannedOpen, setCannedOpen] = useState(false);
  const [isEmojiGridOpen, setIsEmojiGridOpen] = useState(false);
  const [emojiGridPos, setEmojiGridPos] = useState<{ bottom: number; left: number } | null>(null);
  const emojiAnchorRef = useRef<HTMLDivElement | null>(null);
  const emojiGridRef = useRef<HTMLDivElement | null>(null);

  // Latest-opts ref. useEditor instantiates exactly once and freezes its
  // option callbacks at that point — without a ref the editor's
  // handleKeyDown / handlePaste / handleDrop would close over the first
  // render's onSubmit / onEscape and never see updated parent callbacks.
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  // Mirror picker state into refs so the editor's frozen handleKeyDown
  // closure can read the *current* value when Escape is pressed.
  const emojiQueryRef = useRef<string | null>(null);
  useEffect(() => {
    emojiQueryRef.current = emojiQuery;
  }, [emojiQuery]);
  const cannedOpenRef = useRef(false);
  useEffect(() => {
    cannedOpenRef.current = cannedOpen;
  }, [cannedOpen]);

  // Typing emit lifecycle — fold of the absorbed useComposeTyping. The
  // ref pair tracks "we have an outstanding typing:start that wasn't
  // followed by a stop yet" and the timer that auto-stops after 2s idle.
  const isTypingRef = useRef(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTyping = useCallback(() => {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    if (isTypingRef.current) {
      isTypingRef.current = false;
      const socket = getSocket();
      if (socket) socket.emit('typing:stop', { ticketId, whisper: whisperMode });
    }
  }, [ticketId, whisperMode]);

  const emitTyping = useCallback(() => {
    const socket = getSocket();
    if (!socket) return;
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      socket.emit('typing:start', { ticketId, whisper: whisperMode });
    }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      isTypingRef.current = false;
      const s = getSocket();
      if (s) s.emit('typing:stop', { ticketId, whisper: whisperMode });
    }, TYPING_IDLE_MS);
  }, [ticketId, whisperMode]);

  // Unmount flush — guarantees the server drops any phantom indicator
  // even if the user closes the tab mid-keystroke.
  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (isTypingRef.current) {
        isTypingRef.current = false;
        const socket = getSocket();
        if (socket) socket.emit('typing:stop', { ticketId });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draftKey = `${DRAFT_KEY_PREFIX}${user?.id || 'anon'}:${ticket.id}:${whisperMode ? 'whisper' : 'regular'}`;

  // Hydrate once per (user, ticket, mode). When a fresh draft exists we
  // restore it AND flip isDraftLoaded so the parent can show a "draft
  // restored" cue (User Story 4). Stale or missing → text=''.
  useEffect(() => {
    const raw = localStorage.getItem(draftKey);
    if (raw) {
      try {
        const { text: saved, ts } = JSON.parse(raw);
        if (ts && Date.now() - ts < DRAFT_TTL_MS) {
          setText(saved);
          setIsDraftLoaded(true);
          return;
        }
        localStorage.removeItem(draftKey);
      } catch {
        localStorage.removeItem(draftKey);
      }
    }
    setText('');
    setIsDraftLoaded(false);
  }, [draftKey]);

  // Ping-pong guard. Some versions of tiptap-markdown fire onUpdate even
  // when setContent is called with `emitUpdate: false`, so the guard is
  // belt-and-braces — set before the imperative write, cleared on the
  // next microtask so any synchronous rebroadcast is suppressed but
  // future real keystrokes are not.
  const isProgrammaticUpdateRef = useRef(false);

  const editor = useEditor({
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
        class: 'outline-none min-h-[42px] max-h-60 overflow-y-auto py-3 px-2 text-[15px] text-text-primary leading-snug break-words whitespace-pre-wrap',
        'aria-label': 'Type a message',
      },
      handleKeyDown(_view, event) {
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
          // When the emoji suggestion is open, Enter selects an emoji —
          // EmojiSuggestion's document-level capture listener handles it
          // before this point. If we reach this branch with a query, the
          // user wants to send (no matches) — let it through.
          event.preventDefault();
          optsRef.current.onSubmit();
          return true;
        }
        if (event.key === 'Escape') {
          if (emojiQueryRef.current) {
            setEmojiQuery(null);
            return true;
          }
          if (cannedOpenRef.current) {
            setCannedOpen(false);
            return true;
          }
          optsRef.current.onEscape?.();
          return true;
        }
        return false;
      },
      handlePaste(_view, event) {
        const onPaste = optsRef.current.onPaste;
        if (onPaste) {
          const handled = onPaste(event as ClipboardEvent);
          if (handled) return true;
        }
        return false;
      },
      handleDrop(_view, event) {
        const onDrop = optsRef.current.onDrop;
        if (onDrop) {
          const handled = onDrop(event as DragEvent);
          if (handled) return true;
        }
        return false;
      },
    },
    onUpdate({ editor: ed }) {
      if (isProgrammaticUpdateRef.current) return;
      const md = readMarkdown(ed);
      setText(md);
      const m = md.match(EMOJI_QUERY_RE);
      setEmojiQuery(m ? m[1] : null);
      // Canned trigger: support-only, only when buffer starts with `/`.
      // Closes as soon as the buffer doesn't start with `/` so a stray
      // edit doesn't leave the picker stuck open.
      if (isSupport) {
        if (md.startsWith('/')) setCannedOpen(true);
        else setCannedOpen((prev) => (prev ? false : prev));
      }
      emitTyping();
    },
  });

  const editorRef = useRef<Editor | null>(null);
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const writeProgrammatic = useCallback((next: string) => {
    isProgrammaticUpdateRef.current = true;
    setText(next);
    const ed = editorRef.current;
    if (ed && !ed.isDestroyed) {
      try {
        ed.commands.setContent(next, { emitUpdate: false });
      } catch {
        // View not yet mounted — Tiptap's Proxy throws synchronously.
        // Reset the guard so the next real keystroke isn't suppressed,
        // and bail. setText above is enough for the visible contract.
        isProgrammaticUpdateRef.current = false;
        return;
      }
    }
    queueMicrotask(() => {
      isProgrammaticUpdateRef.current = false;
    });
  }, []);

  const replaceText = useCallback(
    (next: string) => {
      writeProgrammatic(next);
    },
    [writeProgrammatic],
  );

  const clear = useCallback(() => {
    setText('');
    const ed = editorRef.current;
    if (ed && !ed.isDestroyed) {
      try {
        ed.commands.setContent('', { emitUpdate: false });
      } catch {
        // View not yet mounted — Tiptap's Proxy throws synchronously
        // here. Bail; setText('') above is enough for the visible
        // contract.
      }
    }
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* localStorage unavailable */
    }
    stopTyping();
  }, [draftKey, stopTyping]);

  // Debounced save — coalesce rapid keystrokes into one localStorage write.
  // Empty text removes the draft so a cleared editor doesn't leave a stale
  // entry behind.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (text) localStorage.setItem(draftKey, JSON.stringify({ text, ts: Date.now() }));
      else localStorage.removeItem(draftKey);
    }, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, draftKey]);

  const selectEmojiSuggestion = useCallback(
    (emoji: string) => {
      // Replace the trailing :word with the emoji. writeProgrammatic
      // keeps editor + text in lockstep and suppresses the typing emit.
      const next = (text || '').replace(EMOJI_QUERY_RE, emoji);
      writeProgrammatic(next);
      setEmojiQuery(null);
    },
    [text, writeProgrammatic],
  );

  const clearEmojiQuery = useCallback(() => setEmojiQuery(null), []);

  const closeCanned = useCallback(() => setCannedOpen(false), []);

  const insertCanned = useCallback(
    (body: string) => {
      writeProgrammatic(body);
      setCannedOpen(false);
    },
    [writeProgrammatic],
  );

  // Global Alt+J shortcut (and any other source) opens the canned picker
  // without requiring the user to type `/` first. SupportView dispatches
  // the event from its keyboard-shortcut handler.
  useEffect(() => {
    if (!isSupport) return;
    const open = () => setCannedOpen(true);
    window.addEventListener(OPEN_CANNED_EVENT, open);
    return () => window.removeEventListener(OPEN_CANNED_EVENT, open);
  }, [isSupport]);

  const toggleEmojiGrid = useCallback(() => setIsEmojiGridOpen((v) => !v), []);
  const closeEmojiGrid = useCallback(() => setIsEmojiGridOpen(false), []);

  // Outside-click close for the emoji grid. The grid is portaled to body
  // so both the anchor wrapper and the grid element need to be excluded.
  useEffect(() => {
    if (!isEmojiGridOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (emojiAnchorRef.current?.contains(target)) return;
      if (emojiGridRef.current?.contains(target)) return;
      setIsEmojiGridOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isEmojiGridOpen]);

  // Anchor fixed-position coords to the trigger wrapper's rect so the
  // portaled grid escapes any overflow-hidden clip on the compose box.
  useLayoutEffect(() => {
    if (!isEmojiGridOpen) return;
    function compute() {
      const el = emojiAnchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setEmojiGridPos({
        bottom: window.innerHeight - r.top + EMOJI_GRID_GAP_PX,
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
  }, [isEmojiGridOpen]);

  const insertEmojiAtCursor = useCallback(
    (emoji: string) => {
      // Cursor-position insert via editor command — does NOT round-trip
      // through setText, so the typing emit fires (this is a real edit).
      // The picker grid is the deliberate-action path; suggestion list
      // uses replaceText instead because it rewrites the trailing :word.
      editorRef.current?.chain().focus().insertContent(emoji).run();
      setIsEmojiGridOpen(false);
    },
    [],
  );

  // Dynamic placeholder — Tiptap's Placeholder extension stores the value
  // at construction time, so a re-render with a new placeholder doesn't
  // pick it up. Imperatively patch the ProseMirror DOM and the
  // extension's stored options. View-Proxy throws if the view isn't
  // mounted yet (ComposeArea is lazy-loaded under Suspense), so wrap in
  // try/catch and re-run on the editor's `create` event.
  useEffect(() => {
    if (!editor) return;
    const apply = () => {
      if (editor.isDestroyed) return;
      try {
        editor.view.dom.setAttribute('data-placeholder', placeholder);
      } catch {
        return;
      }
      const ext = editor.extensionManager.extensions.find(
        (e: { name: string }) => e.name === 'placeholder',
      ) as { options: { placeholder: string } } | undefined;
      if (ext) ext.options.placeholder = placeholder;
    };
    apply();
    editor.on('create', apply);
    return () => {
      editor.off('create', apply);
    };
  }, [editor, placeholder]);

  // Queued focus — Alt+1..9 / Alt+Up/Down switches to a just-mounted
  // chat and fires focus() before useEditor has resolved or the view
  // has committed. The 'create' listener flushes the pending focus as
  // soon as the view mounts.
  const pendingFocusRef = useRef(true);
  const tryFocus = useCallback(() => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return false;
    try {
      ed.commands.focus();
      return true;
    } catch {
      return false;
    }
  }, []);

  const focus = useCallback(() => {
    if (!tryFocus()) pendingFocusRef.current = true;
  }, [tryFocus]);

  useEffect(() => {
    if (!editor) return;
    const flush = () => {
      if (!pendingFocusRef.current) return;
      if (tryFocus()) pendingFocusRef.current = false;
    };
    flush();
    editor.on('create', flush);
    return () => {
      editor.off('create', flush);
    };
  }, [editor, tryFocus]);

  // Memoize on the things PickerPortals reads so EmojiSuggestion (which
  // owns popup positioning state) isn't remounted on every keystroke.
  const dept = ticket.dept;
  const PickerPortals = useMemo<FC>(
    () => () => (
      <>
        {emojiQuery !== null && (
          <EmojiSuggestion
            query={emojiQuery}
            onSelect={selectEmojiSuggestion}
            onClose={clearEmojiQuery}
          />
        )}
        {isSupport && cannedOpen && (
          <CannedResponsePicker
            inputText={text}
            dept={dept}
            ticketId={ticketId}
            onSelect={insertCanned}
            onClose={closeCanned}
          />
        )}
        {isEmojiGridOpen && typeof document !== 'undefined' &&
          createPortal(
            <div
              ref={emojiGridRef}
              role="grid"
              aria-label="Emoji"
              style={
                emojiGridPos
                  ? { position: 'fixed' as const, bottom: emojiGridPos.bottom, left: emojiGridPos.left }
                  : { display: 'none' as const }
              }
              className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-modal)] z-[60] p-2 w-[280px]"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  closeEmojiGrid();
                  return;
                }
                const btns = Array.from(
                  e.currentTarget.querySelectorAll<HTMLButtonElement>('button'),
                );
                const idx = btns.indexOf(e.target as HTMLButtonElement);
                if (idx < 0) return;
                const cols = 8;
                let next = -1;
                if (e.key === 'ArrowRight') next = (idx + 1) % btns.length;
                else if (e.key === 'ArrowLeft') next = (idx - 1 + btns.length) % btns.length;
                else if (e.key === 'ArrowDown') next = Math.min(idx + cols, btns.length - 1);
                else if (e.key === 'ArrowUp') next = Math.max(idx - cols, 0);
                if (next >= 0) {
                  e.preventDefault();
                  btns[next].focus();
                }
              }}
            >
              <div className="grid grid-cols-8 gap-0.5">
                {EMOJI_LIST.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={emoji}
                    onClick={() => insertEmojiAtCursor(emoji)}
                    className="w-8 h-8 flex items-center justify-center text-lg rounded-[var(--radius-btn)] hover:bg-[var(--color-hover)]"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )}
      </>
    ),
    [
      emojiQuery,
      selectEmojiSuggestion,
      clearEmojiQuery,
      isSupport,
      cannedOpen,
      text,
      dept,
      ticketId,
      insertCanned,
      closeCanned,
      isEmojiGridOpen,
      emojiGridPos,
      insertEmojiAtCursor,
      closeEmojiGrid,
    ],
  );

  return {
    editor,
    text,
    replaceText,
    PickerPortals,
    clear,
    focus,
    isDraftLoaded,
    emojiAnchorRef,
    toggleEmojiGrid,
    isEmojiGridOpen,
  };
}

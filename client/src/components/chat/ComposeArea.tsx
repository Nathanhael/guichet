import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import useStore, { useStoreShallow } from '../../store/useStore';
import { getSocket } from '../../hooks/useSocket';
import { useT } from '../../i18n';
import { Ticket, Message } from '../../types';
import { X, Ghost, ImageIcon, Smile, Sparkles, FileText, Send, ALargeSmall } from 'lucide-react';
import { EditorContent, type Editor } from '@tiptap/react';
import FormatToolbar from './FormatToolbar';
import LinkPreviewCard from './LinkPreviewCard';
import Toast from '../Toast';
import CannedResponsePicker from '../CannedResponsePicker';
import { getFileTypeLabel } from '../../utils/fileUtils';
import { useComposeEditor, getEditorMarkdown } from '../../hooks/useComposeEditor';
import { useComposeDraft } from '../../hooks/useComposeDraft';
import { useComposeTyping } from '../../hooks/useComposeTyping';
import { useComposeAttachments } from '../../hooks/useComposeAttachments';
import { useComposeLinkPreview } from '../../hooks/useComposeLinkPreview';
import { useComposeAiImprove } from '../../hooks/useComposeAiImprove';
import { useComposeEmojiPicker } from '../../hooks/useComposeEmojiPicker';
import { EMOJI_LIST } from '../../utils/emojiData';
import EmojiSuggestion from './EmojiSuggestion';

export interface ComposeAreaHandle {
  toggleWhisper: () => void;
  focus: () => void;
}

interface ComposeAreaProps {
  ticket: Ticket;
  isClosed: boolean;
  isSupport: boolean;
  compact?: boolean;
  aiConfig?: { messageImprovement?: string; [key: string]: unknown } | null;
  replyingTo?: Message | null;
  onClearReply?: () => void;
}

const ComposeArea = forwardRef<ComposeAreaHandle, ComposeAreaProps>(function ComposeArea({
  ticket,
  isClosed,
  isSupport,
  compact,
  aiConfig,
  replyingTo,
  onClearReply,
}, ref) {
  const { user } = useStoreShallow(s => ({
    user: s.user,
  }));
  // Transient signal published by useSocket when the server rejects an
  // outgoing message (content guard, repetition limit, …). The matching
  // optimistic bubble is removed in the slice action; here we surface a
  // localized toast for the active ticket and clear the signal so the
  // next rejection can re-trigger the effect.
  const lastRejection = useStore((s) => s.lastRejection);
  const setLastRejection = useStore((s) => s.setLastRejection);
  const t = useT();

  const [text, setText] = useState('');
  const [whisperMode, setWhisperMode] = useState(false);
  const [showCannedPicker, setShowCannedPicker] = useState(false);
  // Global shortcut: Alt+J dispatches `support:open-canned-picker`
  // on SupportView. Listening here keeps the picker owner (this compose
  // area) free of prop-drilling.
  useEffect(() => {
    function open() {
      setShowCannedPicker(true);
    }
    window.addEventListener('support:open-canned-picker', open);
    return () => window.removeEventListener('support:open-canned-picker', open);
  }, []);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
  const [showFormatToolbar, setShowFormatToolbar] = useState(false);

  // Draft persistence — one key per (user, ticket, mode). Each support agent
  // keeps their own in-progress reply across reloads, and whisper vs regular
  // mode stay separate so a private note can't leak into a public reply.
  // The hook owns hydrate + 400ms debounced save + module-level 24h TTL purge.
  const draftKey = `guichet:draft:${user?.id || 'anon'}:${ticket.id}:${whisperMode ? 'whisper' : 'regular'}`;
  useComposeDraft({ user, ticketId: ticket.id, whisperMode, text, setText });
  const { emit: emitTyping, stop: stopTyping } = useComposeTyping({ ticket, whisperMode });
  const {
    pendingFiles,
    uploading,
    isDragOver,
    fileInputRef: fileRef,
    removeFile,
    clearMedia,
    uploadFiles,
    handleFileChange,
    handlePaste,
    dragProps,
  } = useComposeAttachments({
    onError: (err) => {
      if (err.code === 'file_too_large') {
        setToast({
          message: t('file_too_large') || `File exceeds 10MB limit`,
          type: 'error',
        });
      } else {
        const msg = err.detail
          ? `${t('upload_failed') || 'Upload failed'}: ${err.detail}`
          : t('upload_failed') || 'Upload failed. Please try again.';
        setToast({ message: msg, type: 'error' });
      }
    },
  });

  // Latest-editor ref — populated via useEffect after useComposeEditor
  // returns. Used by useComposeEmojiPicker so the hook can be declared
  // BEFORE useComposeEditor (the editor's onUpdate/onSubmit/onEscape
  // closures reference emojiHook methods, so the hook must exist when
  // those closures are created).
  const editorRef = useRef<Editor | null>(null);
  const emojiHook = useComposeEmojiPicker({ editorRef, text, setText });

  // Tiptap editor — the actual interactive surface. text/setText remains
  // the authoritative store for draft persistence, character counter,
  // canned-response trigger, and doSend; the editor's onUpdate callback
  // keeps `text` in lockstep with the markdown representation. All
  // programmatic content changes (drafts hydrate, AI improve, canned,
  // emoji, send-clear) must call BOTH setText(...) AND
  // editor?.commands.setContent(...) so the two stay in sync.
  const editor = useComposeEditor({
    placeholder: whisperMode
      ? (t('whisper_placeholder') || 'Private note for support staff\u2026')
      : (t('type_message') || 'Type a message\u2026'),
    onUpdate: (markdown) => {
      // Short-circuit the write-back when the update was triggered by
      // our own programmatic setContent (draft hydrate / AI improve /
      // canned pick / clear-on-send). Without this guard the markdown
      // round-trip could ping-pong between text state and editor state
      // on lossy serializations (trailing newlines, list marker
      // normalization, etc.).
      if (isProgrammaticUpdateRef.current) return;
      setText(markdown);
      // Canned-response trigger — only when message starts with "/".
      if (isSupport) {
        if (markdown.startsWith('/')) setShowCannedPicker(true);
        else if (showCannedPicker) setShowCannedPicker(false);
      }
      emojiHook.syncQuery(markdown);
      emitTyping();
    },
    onSubmit: () => {
      if (emojiHook.query) return; // Enter selects emoji, don't send
      sendMessage();
    },
    onEscape: () => {
      if (emojiHook.query) { emojiHook.clearQuery(); return; }
      if (showCannedPicker) setShowCannedPicker(false);
      else if (replyingTo && onClearReply) onClearReply();
    },
  });

  useEffect(() => { editorRef.current = editor; }, [editor]);

  // Guard flag: when we programmatically call setContent below, Tiptap's
  // onUpdate may still fire (some versions of tiptap-markdown hook it
  // internally regardless of emitUpdate). The flag lets the onUpdate
  // callback short-circuit and not write back into `text`, preventing a
  // potential ping-pong loop when the markdown round-trip isn't lossless.
  const isProgrammaticUpdateRef = useRef(false);

  // Push text state into the editor when it was set programmatically
  // (draft hydrate, AI improve/revert, canned pick, clear-on-send). We
  // avoid re-setting content that already matches the editor's current
  // markdown, otherwise onUpdate would re-fire and bounce the value.
  //
  // Same Tiptap view-Proxy gotcha as the placeholder effect above:
  // `commands.setContent` ultimately calls `view.dispatch`, which throws
  // synchronously when the view isn't mounted yet. Currently masked because
  // `text` is empty on first mount and the `getEditorMarkdown(...) === text`
  // short-circuit fires — but a draft-hydrated mount during the lazy-load
  // race window would land in the same trap. Wrap in try-catch and let the
  // next text change retry once the view exists. See learning page
  // `learnings/guichet-tiptap-view-proxy-throw` in the cross-project wiki.
  useEffect(() => {
    if (!editor) return;
    if (getEditorMarkdown(editor) === text) return;
    isProgrammaticUpdateRef.current = true;
    try {
      editor.commands.setContent(text, { emitUpdate: false });
    } catch {
      // View not yet mounted — Tiptap's Proxy throws here. Reset the
      // guard flag and bail out; the effect will re-run on the next
      // `text` change once the view is up.
      isProgrammaticUpdateRef.current = false;
      return;
    }
    // Clear on the next microtask so any synchronous onUpdate triggered
    // by setContent is suppressed, but future real keystrokes are not.
    queueMicrotask(() => { isProgrammaticUpdateRef.current = false; });
  }, [editor, text]);

  const { livePreview, dismiss: dismissPreview } = useComposeLinkPreview({ text });

  // Dynamic placeholder — Tiptap's Placeholder extension stores the value
  // at editor construction time and doesn't reactively pick up prop
  // changes on re-render. Imperatively update the ProseMirror root's
  // data-placeholder attribute when whisperMode toggles so the empty-state
  // pseudo-element CSS rule reads the new text.
  //
  // Subtle Tiptap quirk: `editor.view` is a Proxy (see @tiptap/core
  // Editor.ts ~L320-L350). It's always truthy — optional chaining does NOT
  // short-circuit it — and accessing any key besides a small stub set
  // (`composing`, `dragging`, `editable`, `isDestroyed`, `state`) THROWS
  // "[tiptap error]: The editor view is not available" until the underlying
  // view is mounted. With ComposeArea now lazy-loaded under a Suspense
  // boundary, the gap between `useEditor()` returning the instance and
  // EditorContent committing its ref is wide enough to consistently hit this
  // throw. Wrap the access in a try-catch and re-run on the editor's
  // `create` event so the placeholder lands as soon as the view exists.
  useEffect(() => {
    if (!editor) return;
    const apply = () => {
      if (editor.isDestroyed) return;
      const next = whisperMode
        ? (t('whisper_placeholder') || 'Private note for support staff\u2026')
        : (t('type_message') || 'Type a message\u2026');
      try {
        editor.view.dom.setAttribute('data-placeholder', next);
      } catch {
        // View not yet mounted — Tiptap's Proxy throws synchronously here.
        // The 'create' listener below will re-invoke apply() once it is.
        return;
      }
      // Also patch the Placeholder extension's stored options so empty-state
      // renders on initial mount before the first keystroke.
      const placeholderExt = editor.extensionManager.extensions.find(
        (ext: { name: string }) => ext.name === 'placeholder',
      ) as { options: { placeholder: string } } | undefined;
      if (placeholderExt) {
        placeholderExt.options.placeholder = next;
      }
    };
    apply();
    editor.on('create', apply);
    return () => {
      editor.off('create', apply);
    };
  }, [editor, whisperMode, t]);

  // Queue focus requests that arrive before the editor view is mounted.
  // Alt+1..9 / Alt+Up/Down switches to a just-mounted ChatWindow and calls
  // focus immediately; useEditor is async, so the first call usually hits
  // a null editor (or a Proxy whose view isn't ready yet and throws — see
  // the placeholder comment above). The `create` listener flushes any
  // pending focus as soon as the view mounts.
  // Seed true so the caret lands in the compose bar as soon as the chat
  // appears — covers normal tab switches, split-view activation (compose
  // unmounts/remounts when the selected chat changes), and initial open.
  // The existing flush effect below drains the flag on editor 'create'.
  const pendingFocusRef = useRef(true);
  const tryFocus = useCallback(() => {
    if (!editor || editor.isDestroyed) return false;
    try {
      editor.commands.focus();
      return true;
    } catch {
      return false;
    }
  }, [editor]);

  useImperativeHandle(ref, () => ({
    toggleWhisper: () => setWhisperMode((v) => !v),
    focus: () => {
      if (!tryFocus()) pendingFocusRef.current = true;
    },
  }), [tryFocus]);

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

  // Surface server-side rejection of outgoing messages as a localized toast
  // for the currently-open ticket. The matching optimistic bubble is removed
  // in the slice action triggered by useSocket — this effect only handles
  // the user-facing notification. Clear the signal after consuming so a
  // repeat rejection still trips the effect (Zustand only fires on
  // referential change).
  useEffect(() => {
    if (!lastRejection || lastRejection.ticketId !== ticket.id) return;
    setToast({
      message: t(lastRejection.code) || t('guard_blocked_title') || 'Message blocked',
      type: 'error',
    });
    setLastRejection(null);
  }, [lastRejection, ticket.id, t, setLastRejection]);

  const {
    originalText,
    improving,
    improvementMode,
    handleImprove,
    revertImprove,
    improveAndSend,
    reset: resetAiImprove,
  } = useComposeAiImprove({
    text,
    setText,
    isSupport,
    aiConfig,
    doSend: (finalText) => doSend(finalText),
  });

  /** Core send logic -- uploads pending files, then emits socket event with the given text. */
  async function doSend(finalText: string) {
    if (!user?.id) return;

    const hasPending = pendingFiles.length > 0;
    const display = finalText || (hasPending ? '[attachment]' : '');

    // Don't send completely empty messages (no text, no files)
    if (!display && !hasPending) return;

    // Upload files first
    let attachments: Array<{ url: string; name: string; mimeType: string; size: number }> | undefined;
    if (hasPending) {
      attachments = await uploadFiles();
      if (attachments.length === 0 && !finalText) return; // upload failed, no text
    }

    const socket = getSocket();
    if (!socket) {
      setToast({ message: t('not_connected') || 'Not connected. Please wait and try again.', type: 'error' });
      return;
    }

    const localId = `pending-${ticket.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const optimisticMsg: Message = {
      id: localId,
      ticketId: ticket.id,
      senderId: user?.id || '',
      senderName: user?.name || '',
      senderRole: user?.role || 'agent',
      senderLang: user?.lang || 'en',
      originalText: display,
      improvedText: display,
      processedText: display,
      text: display,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      replyToId: replyingTo?.id || null,
      replyTo: replyingTo ? {
        id: replyingTo.id,
        senderName: replyingTo.senderName,
        text: (replyingTo.text || '[Attachment]').slice(0, 100),
        mediaUrl: replyingTo.mediaUrl || null,
      } : null,
      whisper: whisperMode,
      system: 0,
      translationSkipped: 1,
      fallback: 0,
      timestamp: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      reactions: {},
      pending: true,
    };
    useStore.getState().addMessage(ticket.id, optimisticMsg);

    const sendPayload = {
      ticketId: ticket.id,
      senderLang: user?.lang,
      text: display,
      localId,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      whisper: whisperMode,
      replyToId: replyingTo?.id,
    };

    if (socket.connected) {
      // Happy path — socket is up, fire immediately.
      socket.emit('message:send', sendPayload);
    } else {
      // Reconnect queue — don't reject, hold the emit until the socket is
      // back. Soft info toast tells the user their message will land shortly.
      // If reconnect doesn't complete within 10s, surface the real error and
      // mark the optimistic bubble as failed so they can retry manually.
      setToast({ message: t('reconnecting_queue') || 'Reconnecting \u2014 your message will send in a moment\u2026', type: 'success' });
      const timeoutHandle = setTimeout(() => {
        socket.off('connect', onConnect);
        useStore.getState().updateMessageState(ticket.id, localId, { pending: false });
        setToast({ message: t('reconnect_failed') || 'Still disconnected. Message not sent.', type: 'error' });
      }, 10000);
      const onConnect = () => {
        clearTimeout(timeoutHandle);
        socket.off('connect', onConnect);
        socket.emit('message:send', sendPayload);
        setToast(null);
      };
      socket.once('connect', onConnect);
    }
    setText('');
    resetAiImprove();
    clearMedia();
    stopTyping();
    // Clear any persisted draft for this (user, ticket, mode) — the message
    // is now sent, the half-written state is no longer relevant.
    localStorage.removeItem(draftKey);
    if (onClearReply) onClearReply();
  }

  function sendMessage(e?: React.SyntheticEvent<HTMLFormElement>) {
    if (e) e.preventDefault();
    if (uploading) return; // Wait for upload to finish
    const trimmed = text.trim();
    if (!trimmed && pendingFiles.length === 0) return;

    // In 'forced' mode, auto-improve before sending
    if (improvementMode === 'forced' && trimmed.length >= 10 && originalText === null) {
      improveAndSend();
      return;
    }

    doSend(trimmed);
  }

  if (isClosed) return null;

  return (
    <form onSubmit={sendMessage} className={`border-t border-[var(--color-border)] p-4 pb-5 ${whisperMode
      ? 'bg-[var(--color-whisper)]'
      : 'bg-[var(--color-bg-surface)]'
      }`}>
      <div className="w-full">
        {replyingTo && (
          <div className="flex items-start gap-2 px-3 py-2 mb-2 bg-[var(--color-bg-elevated)] rounded-[var(--radius-btn)] border-l-[3px] border-[var(--color-accent)]">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-[var(--color-accent)] truncate">
                {t('replying_to') || 'Replying to'} {replyingTo.senderName}
              </div>
              <div className="text-[12px] text-[var(--color-ink-soft)] truncate">{replyingTo.text || '[Attachment]'}</div>
            </div>
            <button onClick={onClearReply} className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] p-1 shrink-0"><X size={14} /></button>
          </div>
        )}

        {/* AI improved -- revert bar */}
        {originalText !== null && (
          <div className="flex items-center justify-between mb-2 px-3 py-1.5 bg-[var(--color-accent-soft)] rounded-[var(--radius-btn)]">
            <span className="text-[11px] font-semibold text-[var(--color-accent)] flex items-center gap-1.5">
              <Sparkles size={12} />
              {t('ai_improved') || 'AI improved'}
            </span>
            <button
              type="button"
              onClick={revertImprove}
              className="text-[11px] font-medium text-[var(--color-accent)] hover:opacity-80 underline underline-offset-2"
            >
              {t('revert_to_original') || 'Revert to original'}
            </button>
          </div>
        )}

        {/* Multi-file preview strip */}
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-2 p-2 bg-[var(--color-bg-elevated)] rounded-[var(--radius-btn)]">
            {pendingFiles.map((pf, idx) => {
              const isImg = pf.file.type.startsWith('image/');
              const ext = pf.file.name.split('.').pop()?.toLowerCase() || '';
              const label = getFileTypeLabel(ext);
              return (
                <div key={idx} className="relative shrink-0">
                  {isImg ? (
                    <img src={pf.preview} alt={pf.file.name} className="h-16 w-16 object-cover rounded-[var(--radius-btn)] shadow-[var(--shadow-soft)]" />
                  ) : (
                    <div className="h-16 w-16 flex flex-col items-center justify-center rounded-[var(--radius-btn)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
                      <FileText size={22} strokeWidth={1.5} className="text-[var(--color-accent)]" />
                      <span className="text-[10px] font-medium text-[var(--color-ink-muted)] mt-0.5">{label}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center bg-[var(--color-bg-surface)] rounded-full shadow-[var(--shadow-soft)] text-[var(--color-ink-muted)] hover:text-[var(--color-urgent)]"
                    title={t('remove') || 'Remove'}
                  >
                    <X size={10} />
                  </button>
                </div>
              );
            })}
            <div className="flex flex-col gap-0.5 min-w-0 ml-1">
              <span className="text-[11px] font-medium text-[var(--color-ink-soft)]">
                {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''} selected {pendingFiles.length < 5 && `(max 5)`}
              </span>
              <span className="text-[11px] text-[var(--color-ink-muted)]">
                Add a message or press Enter to send
              </span>
            </div>
          </div>
        )}

        {/* Live link preview — one card per detected URL, shown above the
            compose box as soon as the debounced text parses a valid URL.
            Dismissible via the X; reappears if the same URL is retyped. */}
        {livePreview && (
          <div className="relative mb-2">
            <LinkPreviewCard
              url={livePreview.url}
              title={livePreview.title}
              description={livePreview.description}
              image={livePreview.image}
              siteName={livePreview.siteName}
            />
            <button
              type="button"
              onClick={() => dismissPreview(livePreview.url)}
              aria-label={t('dismiss_preview') || 'Dismiss preview'}
              title={t('dismiss_preview') || 'Dismiss preview'}
              className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-[var(--color-bg-surface)] rounded-full shadow-[var(--shadow-soft)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            >
              <X size={10} strokeWidth={2.5} />
            </button>
          </div>
        )}

        {/* Unified compose box — format strip + optional whisper banner + row
            all inside a single bordered container. Accepts drag & drop for
            files. Purple border when whisper mode is active so the private
            state is unmissable. */}
        <div
          {...dragProps}
          className={`relative rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-soft)] ${
            whisperMode ? 'ring-1 ring-[var(--color-whisper-ink)]' : 'ring-1 ring-[var(--color-border)]'
          } ${isDragOver ? 'outline outline-2 outline-[var(--color-accent)] outline-offset-0' : ''}`}
        >
          {whisperMode && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-whisper-ink)] text-white text-[11px] font-semibold">
              <Ghost size={12} strokeWidth={2} />
              <span>{t('whisper_label') || 'Whisper'}</span>
            </div>
          )}

          {showFormatToolbar && <FormatToolbar editor={editor} />}

        <div className={`flex items-center ${compact ? 'gap-1 p-1' : 'gap-2 p-1.5'} ${
          whisperMode
            ? 'bg-[var(--color-whisper)]'
            : 'bg-[var(--color-bg-surface)]'
        }`}>
        <div className={`flex items-center self-center gap-0.5 ${compact ? 'px-0' : 'px-1'}`}>
          {isSupport && (
            <button
              type="button"
              onClick={() => setWhisperMode((v) => !v)}
              aria-label={t('whisper_mode') || 'Toggle whisper mode'}
              title={t('whisper_mode')}
              className={`${compact ? 'w-8 h-8' : 'w-9 h-9'} flex items-center justify-center rounded-full transition-colors ${whisperMode
                ? 'bg-[var(--color-whisper-ink)] text-white'
                : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]'
                }`}
            >
              <Ghost size={compact ? 16 : 18} strokeWidth={2} />
            </button>
          )}

          {!compact && (
            <button
              type="button"
              onClick={() => setShowFormatToolbar((v) => !v)}
              aria-label={t('formatting') || 'Toggle formatting'}
              title={t('formatting') || 'Formatting'}
              className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors ${showFormatToolbar
                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]'
                }`}
            >
              <ALargeSmall size={18} strokeWidth={2} />
            </button>
          )}

          <label className={`${compact ? 'w-8 h-8' : 'w-9 h-9'} flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] cursor-pointer transition-colors`} title={t('attach_file') || 'Attach file'}>
            <ImageIcon size={compact ? 16 : 18} strokeWidth={2} />
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
              aria-label={t('attach_file') || 'Attach files'}
              className="hidden"
              onChange={handleFileChange}
            />
          </label>

          {/* Emoji picker — hidden in compact mode */}
          {!compact && (
          <div className="relative" ref={emojiHook.pickerRef}>
            <button
              type="button"
              onClick={emojiHook.toggle}
              aria-label={t('emoji') || 'Emoji'}
              aria-expanded={emojiHook.isOpen}
              className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors"
              title={t('emoji') || 'Emoji'}
            >
              <Smile size={18} />
            </button>
            {emojiHook.isOpen && typeof document !== 'undefined' && createPortal(
              <div
                ref={emojiHook.gridRef}
                role="grid"
                aria-label={t('emoji') || 'Emoji'}
                style={emojiHook.position
                  ? { position: 'fixed' as const, bottom: emojiHook.position.bottom, left: emojiHook.position.left }
                  : { display: 'none' as const }}
                className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-modal)] z-[60] p-2 w-[280px]"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { emojiHook.close(); return; }
                  const btns = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
                  const idx = btns.indexOf(e.target as HTMLButtonElement);
                  if (idx < 0) return;
                  const cols = 8;
                  let next = -1;
                  if (e.key === 'ArrowRight') next = (idx + 1) % btns.length;
                  else if (e.key === 'ArrowLeft') next = (idx - 1 + btns.length) % btns.length;
                  else if (e.key === 'ArrowDown') next = Math.min(idx + cols, btns.length - 1);
                  else if (e.key === 'ArrowUp') next = Math.max(idx - cols, 0);
                  if (next >= 0) { e.preventDefault(); btns[next].focus(); }
                }}
              >
                <div className="grid grid-cols-8 gap-0.5">
                  {EMOJI_LIST.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      aria-label={emoji}
                      onClick={() => emojiHook.insert(emoji)}
                      className="w-8 h-8 flex items-center justify-center text-lg rounded-[var(--radius-btn)] hover:bg-[var(--color-hover)]"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>,
              document.body
            )}
          </div>
          )}
        </div>

        <div className="relative flex-1">
          {isSupport && showCannedPicker && (
            <CannedResponsePicker
              inputText={text}
              dept={ticket.dept}
              ticketId={ticket.id}
              onSelect={(body) => {
                setText(body);
                setShowCannedPicker(false);
                editor?.chain().focus().run();
              }}
              onClose={() => setShowCannedPicker(false)}
            />
          )}
          {emojiHook.query && (
            <EmojiSuggestion
              query={emojiHook.query}
              onSelect={emojiHook.selectSuggestion}
              onClose={emojiHook.clearQuery}
            />
          )}
          {/* Tiptap WYSIWYG editor — replaces the plain textarea. Onkeydown
              for Enter=send / Escape=dismiss is handled inside
              useComposeEditor via editorProps.handleKeyDown; paste/drop
              events still bubble to the outer wrapper's handlePaste/onDrop. */}
          <div onPaste={handlePaste} aria-label="Type a message">
            <EditorContent
              editor={editor}
              data-placeholder={
              uploading
                ? (t('uploading') || 'Uploading\u2026')
                : pendingFiles.length > 0
                  ? (t('add_message_or_send') || 'Add a message or press Enter to send')
                  : whisperMode
                    ? (t('whisper_placeholder') || 'Private note for support staff\u2026')
                    : (t('type_message') || 'Type a message\u2026')
            }
            />
          </div>
        </div>

        {/* AI Improve button -- only in 'optional' mode */}
        {improvementMode === 'optional' && text.trim().length >= 10 && !originalText && (
          <button
            type="button"
            onClick={handleImprove}
            disabled={improving}
            aria-label={t('improve_message') || 'Improve message'}
            title={t('improve_message') || 'Improve message'}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] disabled:opacity-40 transition-colors"
          >
            {improving ? (
              <span className="text-[10px] font-semibold opacity-60">...</span>
            ) : (
              <Sparkles size={18} />
            )}
          </button>
        )}

        <button
          type="submit"
          disabled={uploading || improving || (!text.trim() && pendingFiles.length === 0)}
          aria-label={t('send') || 'Send'}
          className={`${compact ? 'w-9 h-9 rounded-full' : 'h-9 px-3 rounded-[var(--radius-pill)]'} flex items-center ${compact ? 'justify-center' : 'gap-2'} text-[12px] font-semibold text-white disabled:opacity-40 shadow-[var(--shadow-soft)] hover:opacity-90 transition-opacity ${
            whisperMode ? 'bg-[var(--color-whisper-ink)]' : 'bg-[var(--color-accent)]'
          }`}
          title={improvementMode === 'forced' ? (t('ai_will_improve') || 'AI will improve before sending') : (t('send') || 'Send')}
        >
          <Send size={14} strokeWidth={2.25} />
          {!compact && (
            <span>{whisperMode ? (t('whisper_label') || 'Whisper') : (t('send') || 'Send')}</span>
          )}
        </button>
        </div>

        {/* Drag-drop overlay — visible only while a drag is active */}
        {isDragOver && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center bg-[var(--color-accent-soft)] rounded-[var(--radius-card)] text-[12px] font-semibold text-[var(--color-accent)]">
            {t('drop_files_to_attach') || 'Drop files to attach'}
          </div>
        )}

        </div>{/* /unified compose box */}

        {/* Character counter — reads visual characters from the Tiptap
            CharacterCount extension (not markdown-source bytes), so the
            UI number matches the server-side validation cap.
            `text.length` would count "**" wrapper characters as real
            content, which doesn't match what the user perceives. */}
        {(() => {
          if (!editor) return null;
          const extStorage = editor.storage as unknown as { characterCount?: { characters(): number } };
          const count = extStorage.characterCount?.characters() ?? text.length;
          if (count <= 3500) return null;
          return (
            <div className="flex justify-end mt-1 pr-1">
              <span className={`font-mono text-[11px] tabular-nums ${
                count >= 5000 ? 'text-[var(--color-urgent)]' : count >= 4500 ? 'text-[var(--color-accent-amber)]' : 'text-[var(--color-ink-muted)]'
              }`}>
                {count} / 5000
              </span>
            </div>
          );
        })()}
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </form>
  );
});

export default ComposeArea;

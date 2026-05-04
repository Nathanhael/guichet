import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import useStore, { useStoreShallow } from '../../store/useStore';
import { getSocket } from '../../hooks/useSocket';
import { useT } from '../../i18n';
import { Ticket, Message } from '../../types';
import { X, Ghost, ImageIcon, Smile, Sparkles, FileText, Send, ALargeSmall, Mic, Square } from 'lucide-react';
import { EditorContent } from '@tiptap/react';
import FormatToolbar from './FormatToolbar';
import LinkPreviewCard from './LinkPreviewCard';
import ImproveDiffModal from './ImproveDiffModal';
import Toast from '../Toast';
import { getFileTypeLabel } from '../../utils/fileUtils';
import { useComposeEditor } from '../../hooks/useComposeEditor';
import { useComposeAttachments } from '../../hooks/useComposeAttachments';
import { useComposeLinkPreview } from '../../hooks/useComposeLinkPreview';
import { useComposeAiImprove } from '../../hooks/useComposeAiImprove';
import { useAiHealth } from '../../hooks/useAiHealth';
import { useVoiceTranscribe } from '../../hooks/useVoiceTranscribe';
import { useAutoTranslation } from '../../hooks/useTranslation';

export interface ComposeAreaHandle {
  toggleWhisper: () => void;
  focus: () => void;
  /**
   * Start dictation if mic is idle, stop if currently recording. No-op
   * when transcribing (mid-flight upload) or when the mic button isn't
   * available (partner toggle off, browser unsupported, no permission yet).
   * Used by the Alt+M global shortcut.
   */
  toggleMic: () => void;
}

interface ComposeAreaProps {
  ticket: Ticket;
  isClosed: boolean;
  isSupport: boolean;
  compact?: boolean;
  aiConfig?: { messageImprovement?: string; voiceTranscription?: boolean; [key: string]: unknown } | null;
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

  const [whisperMode, setWhisperMode] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
  const [showFormatToolbar, setShowFormatToolbar] = useState(false);

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
          message: t('file_too_large'),
          type: 'error',
        });
      } else {
        const msg = err.detail
          ? `${t('upload_failed')}: ${err.detail}`
          : t('upload_failed');
        setToast({ message: msg, type: 'error' });
      }
    },
  });

  // Single deep hook — owns the Tiptap editor, draft persistence, typing
  // emit, emoji picker (suggestion + grid), and canned picker. Replaces
  // the prior 5-hook surface (useComposeEditor + useComposeDraft +
  // useComposeTyping + useComposeEmojiPicker + useComposeCanned) along
  // with their cross-hook plumbing (ping-pong guard, hook-order
  // convention, manual editor-refs).
  const compose = useComposeEditor({
    ticket,
    user,
    whisperMode,
    isSupport,
    placeholder: whisperMode
      ? (t('whisper_placeholder'))
      : (t('type_message')),
    onSubmit: () => sendMessage(),
    onEscape: () => {
      if (replyingTo && onClearReply) onClearReply();
    },
  });

  const { livePreview, dismiss: dismissPreview } = useComposeLinkPreview({ text: compose.text });

  // Surface server-side rejection of outgoing messages as a localized toast
  // for the currently-open ticket. The matching optimistic bubble is removed
  // in the slice action triggered by useSocket — this effect only handles
  // the user-facing notification. Clear the signal after consuming so a
  // repeat rejection still trips the effect (Zustand only fires on
  // referential change).
  useEffect(() => {
    if (!lastRejection || lastRejection.ticketId !== ticket.id) return;
    setToast({
      message: t(lastRejection.code) || t('guard_blocked_title'),
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
    pendingImprove,
    confirmSendImproved,
    confirmSendOriginal,
    dismissImprove,
  } = useComposeAiImprove({
    text: compose.text,
    // replaceText keeps the editor and the text mirror in lockstep and
    // suppresses the typing emit during the rewrite — exactly what AI
    // improve needs.
    setText: compose.replaceText,
    isSupport,
    aiConfig,
    doSend: (finalText, opts) => doSend(finalText, opts),
  });

  const aiHealth = useAiHealth({ enabled: improvementMode === 'optional' || improvementMode === 'forced' });

  // Voice transcription (slice 5). Support-only per Decision 1; the partner
  // toggle gates the actual button so the hook can stay always-mounted —
  // simpler than threading the gate through a conditional hook (forbidden
  // by React rules).
  const voiceEnabled = !!aiConfig?.voiceTranscription && isSupport;
  const voice = useVoiceTranscribe({
    enabled: voiceEnabled,
    onTranscript: (transcript: string) => {
      const current = compose.text;
      const trimmedCurrent = current.trimEnd();
      // Decision 5: append with a leading space if compose is non-empty so
      // dictation never glues onto the prior word; replace if the box is
      // empty so the very first dictation doesn't gain a leading space.
      if (trimmedCurrent.length === 0) {
        compose.replaceText(transcript);
      } else {
        compose.replaceText(`${trimmedCurrent} ${transcript}`);
      }
    },
  });
  const showMicButton = voiceEnabled && voice.isSupported;
  const elapsedLabel = `${Math.floor(voice.elapsedSec / 60)}:${String(voice.elapsedSec % 60).padStart(2, '0')}`;

  // Translate the reply-to preview body when the source language differs from
  // the viewer's. Reuses the same Redis cache key as the message bubble's
  // QuoteBlock so a parent already rendered above hits the cache on click.
  const replyTranslation = useAutoTranslation({
    messageId: replyingTo?.id ?? '',
    text: replyingTo?.text ?? '',
    senderLang: replyingTo?.senderLang ?? '',
    viewerLang: user?.lang || 'en',
    enabled: !!replyingTo && aiConfig?.translation === true,
  });
  useEffect(() => {
    if (replyTranslation.needsTranslation) replyTranslation.translate();
  }, [replyTranslation]);
  const replyDisplayText = replyTranslation.translated ?? (replyingTo?.text || '[Attachment]');

  // Imperative handle lives AFTER `voice` + `showMicButton` are in scope so
  // the toggleMic closure can read them. Keep this single useImperativeHandle
  // — duplicate calls with the same ref clobber.
  useImperativeHandle(ref, () => ({
    toggleWhisper: () => setWhisperMode((v) => !v),
    focus: () => compose.focus(),
    toggleMic: () => {
      // Match the visual gating of the mic button below — if the button
      // isn't rendered, the shortcut is also a no-op.
      if (!showMicButton) return;
      if (voice.isTranscribing) return;
      if (voice.isRecording) {
        void voice.stopRecording();
      } else {
        void voice.startRecording();
      }
    },
  }), [compose, showMicButton, voice]);

  /** Core send logic -- uploads pending files, then emits socket event with the given text. */
  async function doSend(finalText: string, opts?: { improvedFromUsageLogId?: string }) {
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
      setToast({ message: t('not_connected'), type: 'error' });
      return;
    }

    const localId = `pending-${ticket.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    // Slice 7: when the agent confirmed an AI-improved draft, optimistically
    // stamp `improvedAt` so the ✨ AI badge renders before the server echo
    // arrives. The server will overwrite with its authoritative timestamp on
    // the message:new echo.
    const stampedImprovedAt = opts?.improvedFromUsageLogId ? new Date().toISOString() : undefined;
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
      improvedAt: stampedImprovedAt,
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
      improvedFromUsageLogId: opts?.improvedFromUsageLogId,
    };

    if (socket.connected) {
      // Happy path — socket is up, fire immediately.
      socket.emit('message:send', sendPayload);
    } else {
      // Reconnect queue — don't reject, hold the emit until the socket is
      // back. Soft info toast tells the user their message will land shortly.
      // If reconnect doesn't complete within 10s, surface the real error and
      // mark the optimistic bubble as failed so they can retry manually.
      setToast({ message: t('reconnecting_queue'), type: 'success' });
      const timeoutHandle = setTimeout(() => {
        socket.off('connect', onConnect);
        useStore.getState().updateMessageState(ticket.id, localId, { pending: false });
        setToast({ message: t('reconnect_failed'), type: 'error' });
      }, 10000);
      const onConnect = () => {
        clearTimeout(timeoutHandle);
        socket.off('connect', onConnect);
        socket.emit('message:send', sendPayload);
        setToast(null);
      };
      socket.once('connect', onConnect);
    }
    // compose.clear() empties the editor, removes the persisted draft,
    // and stops the typing indicator in one call — replacing the prior
    // setText('') + editor.commands.setContent('') + stopTyping() +
    // localStorage.removeItem(draftKey) sequence.
    compose.clear();
    resetAiImprove();
    clearMedia();
    if (onClearReply) onClearReply();
  }

  function sendMessage(e?: React.SyntheticEvent<HTMLFormElement>) {
    if (e) e.preventDefault();
    if (uploading) return; // Wait for upload to finish
    const trimmed = compose.text.trim();
    if (!trimmed && pendingFiles.length === 0) return;

    // In 'forced' mode, auto-improve before sending
    if (improvementMode === 'forced' && trimmed.length >= 10 && originalText === null) {
      improveAndSend();
      return;
    }

    doSend(trimmed);
  }

  if (isClosed) return null;

  // Character counter — read visual chars (not markdown bytes) from the
  // CharacterCount extension so the UI matches the server's 5000-char cap
  // (which also counts visual chars).
  const editor = compose.editor;
  const charCount = (() => {
    if (!editor) return compose.text.length;
    const extStorage = editor.storage as unknown as { characterCount?: { characters(): number } };
    return extStorage.characterCount?.characters() ?? compose.text.length;
  })();

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
                {t('replying_to')} {replyingTo.senderName}
              </div>
              <div className="text-[12px] text-[var(--color-ink-soft)] truncate">{replyDisplayText}</div>
            </div>
            <button onClick={onClearReply} className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] p-1 shrink-0"><X size={14} /></button>
          </div>
        )}

        {/* AI improved -- revert bar */}
        {originalText !== null && (
          <div className="flex items-center justify-between mb-2 px-3 py-1.5 bg-[var(--color-accent-soft)] rounded-[var(--radius-btn)]">
            <span className="text-[11px] font-semibold text-[var(--color-accent)] flex items-center gap-1.5">
              <Sparkles size={12} />
              {t('ai_improved')}
            </span>
            <button
              type="button"
              onClick={revertImprove}
              className="text-[11px] font-medium text-[var(--color-accent)] hover:opacity-80 underline underline-offset-2"
            >
              {t('revert_to_original')}
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
                    title={t('remove')}
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
              aria-label={t('dismiss_preview')}
              title={t('dismiss_preview')}
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
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-whisper-ink)] text-[var(--color-btn-text-inverse)] text-[11px] font-semibold">
              <Ghost size={12} strokeWidth={2} />
              <span>{t('whisper_label')}</span>
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
              aria-label={t('whisper_mode')}
              title={t('whisper_mode')}
              className={`${compact ? 'w-8 h-8' : 'w-9 h-9'} flex items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${whisperMode
                ? 'bg-[var(--color-whisper-ink)] text-[var(--color-btn-text-inverse)]'
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
              aria-label={t('formatting')}
              title={t('formatting')}
              className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${showFormatToolbar
                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]'
                }`}
            >
              <ALargeSmall size={18} strokeWidth={2} />
            </button>
          )}

          <label className={`${compact ? 'w-8 h-8' : 'w-9 h-9'} flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] cursor-pointer transition-colors`} title={t('attach_file')}>
            <ImageIcon size={compact ? 16 : 18} strokeWidth={2} />
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
              aria-label={t('attach_file')}
              className="hidden"
              onChange={handleFileChange}
            />
          </label>

          {/* Emoji picker — hidden in compact mode. Anchor ref + toggle
              live in the hook; the popup renders inside <PickerPortals /> below. */}
          {!compact && (
          <div className="relative" ref={compose.emojiAnchorRef}>
            <button
              type="button"
              onClick={compose.toggleEmojiGrid}
              aria-label={t('emoji')}
              aria-expanded={compose.isEmojiGridOpen}
              className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              title={t('emoji')}
            >
              <Smile size={18} />
            </button>
          </div>
          )}
        </div>

        <div className="relative flex-1">
          {/* PickerPortals owns the emoji suggestion (':word'), the emoji
              grid (smile-button trigger), and the canned-response picker
              (support '/' trigger + Alt+J global event). All three were
              previously parent-rendered. */}
          <compose.PickerPortals />
          {/* Tiptap WYSIWYG editor. Keydown / paste / drop are all wired
              inside the hook (Enter=send, Escape=cascade, paste/drop
              forwarded to attachments). */}
          <div onPaste={handlePaste} aria-label="Type a message">
            <EditorContent
              editor={editor}
              data-placeholder={
              uploading
                ? (t('uploading'))
                : pendingFiles.length > 0
                  ? (t('add_message_or_send'))
                  : whisperMode
                    ? (t('whisper_placeholder'))
                    : (t('type_message'))
            }
            />
          </div>
        </div>

        {/* Voice transcription (slice 5). Three visual states: idle, recording
            (pulsing red dot + elapsed timer), transcribing (spinner + label).
            Hidden entirely when partner toggle is off, when this is the agent
            surface, or when MediaRecorder is missing in this browser. */}
        {showMicButton && voice.isTranscribing && (
          <div
            className="flex items-center gap-1.5 h-9 px-2 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] text-[11px] font-semibold text-[var(--color-ink-soft)]"
            aria-live="polite"
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-[v2p-dot_1s_ease-in-out_infinite]" />
            <span>{t('voice_transcribing')}</span>
          </div>
        )}
        {showMicButton && !voice.isTranscribing && voice.isRecording && (
          <button
            type="button"
            onClick={() => { void voice.stopRecording(); }}
            aria-pressed={true}
            aria-label={t('voice_stop')}
            title={t('voice_stop')}
            className="flex items-center gap-1.5 h-9 px-2 rounded-[var(--radius-pill)] bg-[var(--color-urgent-soft,var(--color-bg-elevated))] text-[var(--color-urgent)] hover:opacity-90 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-urgent)] animate-[v2p-pulse_1.8s_ease-in-out_infinite]" />
            <span className="font-mono text-[11px] tabular-nums">{elapsedLabel}</span>
            <Square size={12} strokeWidth={2.5} fill="currentColor" />
          </button>
        )}
        {showMicButton && !voice.isRecording && !voice.isTranscribing && (
          <button
            type="button"
            onClick={() => { void voice.startRecording(); }}
            aria-pressed={false}
            aria-label={t('voice_start')}
            title={t('voice_start')}
            disabled={voice.isTranscribing}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] disabled:opacity-40 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            <Mic size={18} strokeWidth={2} />
          </button>
        )}

        {/* AI Improve button — only in 'optional' mode and only when AI provider is reachable */}
        {improvementMode === 'optional' && aiHealth.available && compose.text.trim().length >= 10 && !originalText && (
          <button
            type="button"
            onClick={handleImprove}
            disabled={improving}
            aria-label={t('improve_message')}
            title={t('improve_message')}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] disabled:opacity-40 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
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
          disabled={uploading || improving || (!compose.text.trim() && pendingFiles.length === 0)}
          aria-label={t('send')}
          className={`${compact ? 'w-9 h-9 rounded-full' : 'h-9 px-3 rounded-[var(--radius-pill)]'} flex items-center ${compact ? 'justify-center' : 'gap-2'} text-[12px] font-semibold text-[var(--color-btn-text-inverse)] disabled:opacity-40 shadow-[var(--shadow-soft)] hover:opacity-90 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
            whisperMode ? 'bg-[var(--color-whisper-ink)]' : 'bg-[var(--color-accent)]'
          }`}
          title={improvementMode === 'forced' ? (t('ai_will_improve')) : (t('send'))}
        >
          <Send size={14} strokeWidth={2.25} />
          {!compact && (
            <span>{whisperMode ? (t('whisper_label')) : (t('send'))}</span>
          )}
        </button>
        </div>

        {/* Drag-drop overlay — visible only while a drag is active */}
        {isDragOver && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center bg-[var(--color-accent-soft)] rounded-[var(--radius-card)] text-[12px] font-semibold text-[var(--color-accent)]">
            {t('drop_files_to_attach')}
          </div>
        )}

        </div>{/* /unified compose box */}

        {/* Voice transcription error chip — Decision 9: surface the i18n
            error key as a small inline chip beneath the compose box. The
            chip auto-clears on the next mic-button click (startRecording
            resets `error` to null). */}
        {showMicButton && voice.error && (
          <div
            className="mt-1.5 px-3 py-1.5 rounded-[var(--radius-btn)] bg-[var(--color-urgent-soft,var(--color-bg-elevated))] text-[11px] font-medium text-[var(--color-urgent)]"
            role="alert"
          >
            {t(voice.error) || voice.error}
          </div>
        )}

        {charCount > 3500 && (
          <div className="flex justify-end mt-1 pr-1">
            <span className={`font-mono text-[11px] tabular-nums ${
              charCount >= 5000 ? 'text-[var(--color-urgent)]' : charCount >= 4500 ? 'text-[var(--color-accent-amber)]' : 'text-[var(--color-ink-muted)]'
            }`}>
              {charCount} / 5000
            </span>
          </div>
        )}
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {pendingImprove && (
        <ImproveDiffModal
          pending={pendingImprove}
          onSendImproved={() => { void confirmSendImproved(); }}
          onSendOriginal={() => { void confirmSendOriginal(); }}
          onDismiss={() => { dismissImprove(); compose.focus(); }}
        />
      )}
    </form>
  );
});

export default ComposeArea;

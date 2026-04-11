import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import useStore, { useStoreShallow } from '../../store/useStore';
import { getSocket } from '../../hooks/useSocket';
import { useT } from '../../i18n';
import { Ticket, Message } from '../../types';
import { trpc } from '../../utils/trpc';
import { X, Ghost, ImageIcon, Smile, Sparkles, FileText, Send } from 'lucide-react';
import FormatToolbar from './FormatToolbar';
import Toast from '../Toast';
import CannedResponsePicker from '../CannedResponsePicker';
import { getFileTypeLabel } from '../../utils/fileUtils';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export interface ComposeAreaHandle {
  toggleWhisper: () => void;
}

interface ComposeAreaProps {
  ticket: Ticket;
  isClosed: boolean;
  isSupport: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  replyingTo?: Message | null;
  onClearReply?: () => void;
}

const ComposeArea = forwardRef<ComposeAreaHandle, ComposeAreaProps>(function ComposeArea({
  ticket,
  isClosed,
  isSupport,
  textareaRef,
  replyingTo,
  onClearReply,
}, ref) {
  const { user } = useStoreShallow(s => ({
    user: s.user,
  }));
  const t = useT();

  const [text, setText] = useState('');
  const [whisperMode, setWhisperMode] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<Array<{ file: File; preview: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showCannedPicker, setShowCannedPicker] = useState(false);
  const [originalText, setOriginalText] = useState<string | null>(null);
  const [improving, setImproving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Draft persistence — one key per (user, ticket, mode). Each support agent
  // keeps their own in-progress reply across reloads, and whisper vs regular
  // mode stay separate so a private note can't leak into a public reply.
  const draftKey = `tessera:draft:${user?.id || 'anon'}:${ticket.id}:${whisperMode ? 'whisper' : 'regular'}`;

  // Hydrate draft once per key change (ticket switch, whisper toggle).
  useEffect(() => {
    const saved = sessionStorage.getItem(draftKey);
    if (saved) setText(saved);
    else setText('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // Debounced save — 400ms after the last keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (text) sessionStorage.setItem(draftKey, text);
      else sessionStorage.removeItem(draftKey);
    }, 400);
    return () => clearTimeout(timer);
  }, [text, draftKey]);

  const fileRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);
  const pendingFilesRef = useRef(pendingFiles);
  pendingFilesRef.current = pendingFiles;

  useImperativeHandle(ref, () => ({
    toggleWhisper: () => setWhisperMode((v) => !v),
  }), []);

  // Cleanup on unmount: revoke Object URLs + stop typing indicator
  useEffect(() => {
    return () => {
      pendingFilesRef.current.forEach(pf => URL.revokeObjectURL(pf.preview));
      // Clear typing timeout and emit typing:stop so server doesn't show phantom indicator
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (isTypingRef.current) {
        isTypingRef.current = false;
        const socket = getSocket();
        if (socket) socket.emit('typing:stop', { ticketId: ticket.id });
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close emoji picker on outside click
  useEffect(() => {
    if (!showEmojiPicker) return;
    function handleClickOutside(e: MouseEvent) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmojiPicker]);

  // tRPC: AI Config (to show/hide Improve button)
  const aiConfigQuery = trpc.partner.getAiConfig.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
  });
  const aiConfig = aiConfigQuery.data;

  const improveMutation = trpc.ai.improveMessage.useMutation();
  const improvementMode = aiConfig?.messageImprovement ?? 'off';

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [textareaRef]);

  function emitTyping() {
    const socket = getSocket();
    if (!socket) return;
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      // Server derives senderName from socket.data — don't send client identity.
      // whisper flag tells the server to route the indicator only to staff
      // sockets in the ticket room (never the agent) while we compose a note.
      socket.emit('typing:start', { ticketId: ticket.id, whisper: whisperMode });
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      const s = getSocket();
      if (s) s.emit('typing:stop', { ticketId: ticket.id, whisper: whisperMode });
    }, 2000);
  }

  function stopTyping() {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      const socket = getSocket();
      if (socket) socket.emit('typing:stop', { ticketId: ticket.id, whisper: whisperMode });
    }
  }

  function addFiles(files: File[]) {
    const remaining = 5 - pendingFiles.length;
    if (remaining <= 0) return;
    const oversized = files.filter(f => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      setToast({ message: t('file_too_large') || `File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`, type: 'error' });
    }
    const valid = files.filter(f => f.size <= MAX_FILE_SIZE);
    const toAdd = valid.slice(0, remaining).map(file => ({
      file,
      preview: URL.createObjectURL(file),
    }));
    setPendingFiles(prev => [...prev, ...toAdd]);
  }

  function removeFile(index: number) {
    setPendingFiles(prev => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function uploadFiles(): Promise<Array<{ url: string; name: string; mimeType: string; size: number }>> {
    const currentFiles = pendingFilesRef.current;
    if (currentFiles.length === 0) return [];
    setUploading(true);
    try {
      const form = new FormData();
      for (const pf of currentFiles) {
        form.append('files', pf.file);
      }
      const res = await fetch('/api/v1/uploads/multi', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        const errorMsg = data.error || 'Unknown error';
        console.error('Upload failed:', errorMsg);
        setToast({ message: t('upload_failed') || `Upload failed: ${errorMsg}`, type: 'error' });
        return [];
      }
      return data as Array<{ url: string; name: string; mimeType: string; size: number }>;
    } catch {
      setToast({ message: t('upload_failed') || 'Upload failed. Please try again.', type: 'error' });
      return [];
    } finally {
      setUploading(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    addFiles(files);
    if (fileRef.current) fileRef.current.value = '';
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pastedFiles: File[] = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) pastedFiles.push(file);
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault();
      addFiles(pastedFiles);
    }
  }

  function clearMedia() {
    pendingFiles.forEach(pf => URL.revokeObjectURL(pf.preview));
    setPendingFiles([]);
    if (fileRef.current) fileRef.current.value = '';
  }

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
      socket.on('connect', onConnect);
    }
    setText('');
    setOriginalText(null);
    clearMedia();
    stopTyping();
    // Clear any persisted draft for this (user, ticket, mode) — the message
    // is now sent, the half-written state is no longer relevant.
    sessionStorage.removeItem(draftKey);
    if (onClearReply) onClearReply();
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }

  function sendMessage(e?: React.FormEvent) {
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

  async function handleImprove() {
    if (improving || text.trim().length < 10) return;
    setImproving(true);
    setOriginalText(text);
    try {
      const result = await improveMutation.mutateAsync({
        text: text.trim(),
        role: isSupport ? 'support' : 'agent',
      });
      setText(result.improved);
    } catch {
      // On failure, keep original text
      setOriginalText(null);
    } finally {
      setImproving(false);
    }
  }

  function revertImprove() {
    if (originalText !== null) {
      setText(originalText);
      setOriginalText(null);
    }
  }

  /** For 'forced' mode: improve text before sending, then send. */
  async function improveAndSend() {
    if (improving) return;
    const trimmed = text.trim();
    if (!trimmed && pendingFiles.length === 0) return;

    // Only improve if text is long enough and not already improved
    if (trimmed.length >= 10 && originalText === null) {
      setImproving(true);
      try {
        const result = await improveMutation.mutateAsync({
          text: trimmed,
          role: isSupport ? 'support' : 'agent',
        });
        // Send the improved version directly
        doSend(result.improved);
      } catch {
        // On AI failure, send original text (graceful degradation)
        doSend(trimmed);
      } finally {
        setImproving(false);
      }
    } else {
      doSend(trimmed);
    }
  }

  if (isClosed) return null;

  return (
    <form onSubmit={sendMessage} className={`border-t-2 p-4 pb-6 ${whisperMode
      ? 'bg-bg-elevated border-border-heavy'
      : 'bg-bg-surface border-border-heavy'
      }`}>
      <div className="w-full">
        {replyingTo && (
          <div className="flex items-start gap-2 px-4 py-2 bg-bg-elevated border-l-[3px] border-accent-blue">
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[9px] font-bold text-accent-blue truncate">
                {t('replying_to') || 'Replying to'} {replyingTo.senderName}
              </div>
              <div className="text-[11px] text-text-secondary truncate">{replyingTo.text || '[Attachment]'}</div>
            </div>
            <button onClick={onClearReply} className="text-text-secondary hover:text-text-primary p-1 shrink-0"><X size={14} /></button>
          </div>
        )}

        {/* AI improved -- revert bar */}
        {originalText !== null && (
          <div className="flex items-center justify-between mb-2 px-3 py-1.5 bg-bg-elevated border border-border-heavy">
            <span className="text-[10px] font-bold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles size={12} />
              {t('ai_improved') || 'AI improved'}
            </span>
            <button
              type="button"
              onClick={revertImprove}
              className="text-[10px] font-bold text-text-primary hover:opacity-60 underline underline-offset-2"
            >
              {t('revert_to_original') || 'Revert to original'}
            </button>
          </div>
        )}

        {/* Multi-file preview strip */}
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-2 p-2 bg-bg-elevated border border-border">
            {pendingFiles.map((pf, idx) => {
              const isImg = pf.file.type.startsWith('image/');
              const ext = pf.file.name.split('.').pop()?.toLowerCase() || '';
              const label = getFileTypeLabel(ext);
              return (
                <div key={idx} className="relative shrink-0">
                  {isImg ? (
                    <img src={pf.preview} alt={pf.file.name} className="h-16 w-16 object-cover border border-border" />
                  ) : (
                    <div className="h-16 w-16 flex flex-col items-center justify-center border border-border bg-bg-surface">
                      <FileText size={24} strokeWidth={1.5} className="text-accent-blue" />
                      <span className="text-[8px] font-mono font-bold text-text-muted mt-0.5">{label}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center bg-bg-surface border border-border text-text-muted hover:text-accent-red text-[10px]"
                    title={t('remove') || 'Remove'}
                  >
                    <X size={10} />
                  </button>
                </div>
              );
            })}
            <div className="flex flex-col gap-0.5 min-w-0 ml-1">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-text-muted">
                {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''} selected {pendingFiles.length < 5 && `(max 5)`}
              </span>
              <span className="text-[9px] text-text-muted opacity-40">
                Add a message or press Enter to send
              </span>
            </div>
          </div>
        )}

        {/* Unified compose box — format strip + optional whisper banner + row
            all inside a single bordered container. Accepts drag & drop for
            files. Purple border when whisper mode is active so the private
            state is unmissable. */}
        <div
          onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragOver={(e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy'; } catch { /* some browsers throw on certain drag types */ } }}
          onDragLeave={(e) => {
            // Only clear when the drag actually leaves the outer box, not
            // when it crosses into a child element.
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setIsDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            const files = Array.from(e.dataTransfer.files).filter(Boolean);
            if (files.length > 0) addFiles(files);
          }}
          className={`relative border-2 ${
            whisperMode ? 'border-accent-purple' : 'border-border-heavy'
          } ${isDragOver ? 'outline outline-2 outline-accent-blue outline-offset-0' : ''}`}
        >
          {whisperMode && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-accent-purple text-white font-mono text-[9px] font-bold uppercase tracking-[0.14em]">
              <Ghost size={11} strokeWidth={2.5} />
              <span>{t('whisper_label') || 'Whisper'}</span>
              <span className="opacity-80 font-medium normal-case tracking-tight">· {t('whisper_hint') || 'only visible to support staff'}</span>
            </div>
          )}

          <FormatToolbar textareaRef={textareaRef} onTextChange={setText} getText={() => text} />

        <div className={`flex items-center gap-3 p-1.5 ${
          whisperMode
            ? 'bg-whisper-bg'
            : 'bg-bg-elevated'
        }`}>
        <div className="flex items-center self-center px-1">
          {isSupport && (
            <button
              type="button"
              onClick={() => setWhisperMode((v) => !v)}
              aria-label={t('whisper_mode') || 'Toggle whisper mode'}
              title={t('whisper_mode')}
              className={`w-10 h-10 flex items-center justify-center ${whisperMode
                ? 'bg-accent-blue text-[var(--color-btn-text-inverse)]'
                : 'text-text-primary opacity-40 hover:opacity-100'
                }`}
            >
              <Ghost size={20} strokeWidth={2.5} />
            </button>
          )}

          <label className="w-10 h-10 flex items-center justify-center text-text-primary opacity-40 hover:opacity-100 cursor-pointer" title={t('attach_file') || 'Attach file'}>
            <ImageIcon size={20} strokeWidth={2.5} />
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

          {/* Emoji picker */}
          <div className="relative" ref={emojiPickerRef}>
            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              aria-label={t('emoji') || 'Emoji'}
              aria-expanded={showEmojiPicker}
              className="w-10 h-10 flex items-center justify-center text-text-primary opacity-40 hover:opacity-100"
              title={t('emoji') || 'Emoji'}
            >
              <Smile size={20} />
            </button>
            {showEmojiPicker && (
              <div
                role="grid"
                aria-label={t('emoji') || 'Emoji'}
                className="absolute bottom-full left-0 mb-2 bg-bg-surface border-2 border-border-heavy z-50 p-2 w-[280px]"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setShowEmojiPicker(false); return; }
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
                  {['😀','😂','🙂','😊','😍','😎','🤔','😅','😢','😤','👋','🙏','👍','👎','👏','❤️','🔥','⭐','✅','🎉','💡','⚠️','💬','📎'].map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      aria-label={emoji}
                      onClick={() => {
                        const ta = textareaRef.current;
                        if (ta) {
                          const start = ta.selectionStart;
                          const end = ta.selectionEnd;
                          const newText = text.slice(0, start) + emoji + text.slice(end);
                          setText(newText);
                          setShowEmojiPicker(false);
                          setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + emoji.length; }, 0);
                        } else {
                          setText(text + emoji);
                          setShowEmojiPicker(false);
                        }
                      }}
                      className="w-8 h-8 flex items-center justify-center text-lg hover:bg-bg-elevated"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
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
                textareaRef.current?.focus();
                requestAnimationFrame(() => autoResize());
              }}
              onClose={() => setShowCannedPicker(false)}
            />
          )}
          <textarea
            ref={textareaRef}
            aria-label="Type a message"
            value={text}
            onChange={(e) => {
              const val = e.target.value;
              setText(val);
              if (isSupport) {
                if (val.startsWith('/')) {
                  setShowCannedPicker(true);
                } else if (showCannedPicker) {
                  setShowCannedPicker(false);
                }
              }
              emitTyping();
              autoResize();
            }}
            onKeyDown={(e) => {
              if (showCannedPicker) {
                if (['ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) {
                  return; // CannedResponsePicker handles these via global keydown listener
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setShowCannedPicker(false);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
              if (e.key === 'Escape' && replyingTo && onClearReply) { onClearReply(); }
            }}
            onPaste={handlePaste}
            placeholder={
              uploading
                ? (t('uploading') || 'Uploading\u2026')
                : pendingFiles.length > 0
                  ? (t('add_message_or_send') || 'Add a message or press Enter to send')
                  : whisperMode
                    ? (t('whisper_placeholder') || 'Private note for support staff\u2026')
                    : (t('type_message') || 'Type a message\u2026')
            }
            rows={1}
            className="w-full resize-none bg-transparent border-none py-3 px-2 text-[15px] focus:ring-0 text-text-primary placeholder:opacity-30 scrollbar-none overflow-hidden"
          />
        </div>

        {/* AI Improve button -- only in 'optional' mode */}
        {improvementMode === 'optional' && text.trim().length >= 10 && !originalText && (
          <button
            type="button"
            onClick={handleImprove}
            disabled={improving}
            aria-label={t('improve_message') || 'Improve message'}
            title={t('improve_message') || 'Improve message'}
            className="w-10 h-10 flex items-center justify-center text-text-primary opacity-40 hover:opacity-100 disabled:opacity-30"
          >
            {improving ? (
              <span className="text-[10px] font-bold opacity-40">...</span>
            ) : (
              <Sparkles size={20} />
            )}
          </button>
        )}

        <button
          type="submit"
          disabled={uploading || improving || (!text.trim() && pendingFiles.length === 0)}
          aria-label={t('send') || 'Send'}
          className={`h-10 px-3 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-btn-text-inverse)] disabled:opacity-30 ${
            whisperMode ? 'bg-accent-purple' : 'bg-accent-blue'
          }`}
          title={improvementMode === 'forced' ? (t('ai_will_improve') || 'AI will improve before sending') : (t('send') || 'Send')}
        >
          <Send size={14} strokeWidth={2.5} />
          <span>{whisperMode ? (t('whisper_label') || 'Whisper') : (t('send') || 'Send')}</span>
          <span className="inline-flex items-center text-[8px] font-bold px-1 border border-white/40 opacity-70">⏎</span>
        </button>
        </div>

        {/* Drag-drop overlay — visible only while a drag is active */}
        {isDragOver && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center bg-accent-blue/20 border-2 border-dashed border-accent-blue font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-accent-blue">
            {t('drop_files_to_attach') || 'Drop files to attach'}
          </div>
        )}

        </div>{/* /unified compose box */}

        {/* Character counter — appears only when text is getting close to
            the 5000-char server limit. Amber at 90%, red at 100%. */}
        {text.length > 3500 && (
          <div className="flex justify-end mt-1 pr-1">
            <span className={`font-mono text-[9px] font-bold tabular-nums ${
              text.length >= 5000 ? 'text-accent-red' : text.length >= 4500 ? 'text-accent-amber' : 'text-text-muted'
            }`}>
              {text.length} / 5000
            </span>
          </div>
        )}
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </form>
  );
});

export default ComposeArea;

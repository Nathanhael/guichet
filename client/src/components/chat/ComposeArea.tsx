import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import useStore, { useStoreShallow } from '../../store/useStore';
import { getSocket } from '../../hooks/useSocket';
import { useT } from '../../i18n';
import { Ticket, Message } from '../../types';
import { trpc } from '../../utils/trpc';
import { X } from 'lucide-react';
import FormatToolbar from './FormatToolbar';

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
  const [originalText, setOriginalText] = useState<string | null>(null);
  const [improving, setImproving] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);

  useImperativeHandle(ref, () => ({
    toggleWhisper: () => setWhisperMode((v) => !v),
  }), []);

  // CR-10: Revoke Object URLs to prevent memory leaks
  useEffect(() => {
    return () => {
      pendingFiles.forEach(pf => URL.revokeObjectURL(pf.preview));
    };
  }, [pendingFiles]);

  // tRPC: AI Config (to show/hide Improve button)
  const aiConfigQuery = trpc.partner.getAiConfig.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
  });
  const aiConfig = aiConfigQuery.data;

  const improveMutation = trpc.ai.improveMessage.useMutation();
  const improvementMode = aiConfig?.messageImprovement ?? 'off';

  const autoResize = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  };

  function emitTyping() {
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      getSocket().emit('typing:start', { ticketId: ticket.id, senderName: user?.name });
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      getSocket().emit('typing:stop', { ticketId: ticket.id, senderName: user?.name });
    }, 2000);
  }

  function stopTyping() {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      getSocket().emit('typing:stop', { ticketId: ticket.id, senderName: user?.name });
    }
  }

  function addFiles(files: File[]) {
    const remaining = 5 - pendingFiles.length;
    if (remaining <= 0) return;
    const toAdd = files.slice(0, remaining).map(file => ({
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
    if (pendingFiles.length === 0) return [];
    setUploading(true);
    try {
      const form = new FormData();
      for (const pf of pendingFiles) {
        form.append('files', pf.file);
      }
      const res = await fetch('/api/v1/uploads/multi', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        console.error('Upload failed:', data.error || 'Unknown error');
        return [];
      }
      return data as Array<{ url: string; name: string; mimeType: string; size: number }>;
    } catch {
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

    const optimisticMsg: Message = {
      id: `pending-${ticket.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
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

    getSocket().emit('message:send', {
      ticketId: ticket.id,
      senderLang: user?.lang,
      text: display,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      whisper: whisperMode,
      replyToId: replyingTo?.id,
    });
    setText('');
    setOriginalText(null);
    clearMedia();
    stopTyping();
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

        {whisperMode && (
        <div className="flex items-center gap-2 mb-3">
          <div className="px-2 py-0.5 bg-accent-blue text-[var(--color-btn-text-inverse)] text-[9px] font-bold uppercase tracking-widest">Whisper</div>
          <p className="text-[10px] text-text-primary font-bold uppercase tracking-tight opacity-80">
            {t('whisper_hint')}
          </p>
        </div>
        )}

        {/* AI improved -- revert bar */}
        {originalText !== null && (
          <div className="flex items-center justify-between mb-2 px-3 py-1.5 bg-bg-elevated border border-border-heavy">
            <span className="text-[10px] font-bold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              AI improved
            </span>
            <button
              type="button"
              onClick={revertImprove}
              className="text-[10px] font-bold text-text-primary hover:opacity-60 underline underline-offset-2"
            >
              Revert to original
            </button>
          </div>
        )}

        {/* Multi-file preview strip */}
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-2 p-2 bg-bg-elevated border border-border">
            {pendingFiles.map((pf, idx) => {
              const isImg = pf.file.type.startsWith('image/');
              const ext = pf.file.name.split('.').pop()?.toLowerCase() || '';
              const label = ext === 'pdf' ? 'PDF' : ext === 'docx' || ext === 'doc' ? 'Word' : ext === 'xlsx' || ext === 'xls' ? 'Excel' : ext === 'csv' ? 'CSV' : ext === 'txt' ? 'Text' : 'File';
              return (
                <div key={idx} className="relative shrink-0">
                  {isImg ? (
                    <img src={pf.preview} alt={pf.file.name} className="h-16 w-16 object-cover border border-border" />
                  ) : (
                    <div className="h-16 w-16 flex flex-col items-center justify-center border border-border bg-bg-surface">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-accent-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                      <span className="text-[8px] font-mono font-bold text-text-muted mt-0.5">{label}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center bg-bg-surface border border-border text-text-muted hover:text-accent-red text-[10px]"
                    title="Remove"
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

        <FormatToolbar textareaRef={textareaRef} onTextChange={setText} getText={() => text} />

        <div className={`flex items-center gap-3 p-1.5 border-2 ${
          whisperMode
            ? 'bg-bg-surface border-border-heavy'
            : 'bg-bg-elevated border-border-heavy'
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
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268-2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
            </button>
          )}

          <label className="w-10 h-10 flex items-center justify-center text-text-primary opacity-40 hover:opacity-100 cursor-pointer" title="Attach file">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
              aria-label="Attach files"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>

          {/* Emoji picker */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="w-10 h-10 flex items-center justify-center text-text-primary opacity-40 hover:opacity-100"
              title="Emoji"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z" />
              </svg>
            </button>
            {showEmojiPicker && (
              <div className="absolute bottom-full left-0 mb-2 bg-bg-surface border-2 border-border-heavy z-50 p-2 w-[280px]">
                <div className="grid grid-cols-8 gap-0.5">
                  {['😀','😂','🙂','😊','😍','😎','🤔','😅','😢','😤','👋','🙏','👍','👎','👏','❤️','🔥','⭐','✅','🎉','💡','⚠️','💬','📎'].map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
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
          {/* DISABLED_FEATURE: CannedResponsePicker removed until production-ready */}
          <textarea
            ref={textareaRef}
            aria-label="Type a message"
            value={text}
            onChange={(e) => {
              const val = e.target.value;
              setText(val);
              // DISABLED_FEATURE: canned picker "/" trigger removed until production-ready
              emitTyping();
              autoResize();
            }}
            onKeyDown={(e) => {
              // DISABLED_FEATURE: canned picker key guard removed until production-ready
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
              if (e.key === 'Escape' && replyingTo && onClearReply) { onClearReply(); }
            }}
            onPaste={handlePaste}
            placeholder={uploading ? 'Uploading...' : pendingFiles.length > 0 ? 'Add a message or press Enter to send' : t('type_message')}
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
            aria-label="Improve message"
            title="AI: Improve message"
            className="w-10 h-10 flex items-center justify-center text-text-primary opacity-40 hover:opacity-100 disabled:opacity-30"
          >
            {improving ? (
              <span className="text-[10px] font-bold opacity-40">...</span>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
              </svg>
            )}
          </button>
        )}

        <button
          type="submit"
          disabled={uploading || improving || (!text.trim() && pendingFiles.length === 0)}
          className="bg-accent-blue text-[var(--color-btn-text-inverse)] w-10 h-10 flex items-center justify-center disabled:opacity-30"
          title={improvementMode === 'forced' ? 'AI will improve before sending' : undefined}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 rotate-90" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
          </svg>
        </button>
        </div>
      </div>
    </form>
  );
});

export default ComposeArea;

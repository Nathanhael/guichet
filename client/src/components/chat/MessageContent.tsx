import BionicText from '../BionicText';
import { Message } from '../../types';
import AttachmentGrid from './AttachmentGrid';
import QuoteBlock from './QuoteBlock';
import LinkPreviewCard from './LinkPreviewCard';
import { hasMarkdownSyntax, renderMarkdown } from '../../utils/markdown';
import { getFileTypeLabel } from '../../utils/fileUtils';
import { FileText } from 'lucide-react';
import { highlightText } from '../../utils/highlightText';
import useStore from '../../store/useStore';

interface MessageContentProps {
  message: Message;
  displayText: string;
  isDeleted: boolean;
  bionicReading: boolean;
  highlightQuery?: string;
}

export default function MessageContent({
  message,
  displayText,
  isDeleted,
  bionicReading,
  highlightQuery,
}: MessageContentProps) {
  return (
    <>
      {/* Quote block for replies */}
      {message.replyTo && (() => {
        const reply = message.replyTo;
        return (
          <QuoteBlock
            senderName={reply.senderName}
            text={reply.text}
            isDeleted={!reply.text && !reply.mediaUrl}
            onClick={() => {
              const el = document.getElementById(`msg-${reply.id}`);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('bg-[var(--color-accent-soft)]');
                setTimeout(() => el.classList.remove('bg-[var(--color-accent-soft)]'), 1000);
              }
            }}
          />
        );
      })()}

      {/* Text content: markdown / bionic / plain */}
      {!isDeleted && displayText.trim() && displayText.trim() !== '[attachment]' ? (
        !bionicReading && hasMarkdownSyntax(displayText) ? (
          <div
            className="msg-markdown text-[13px] break-words leading-snug text-left max-h-60 overflow-y-auto"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(displayText) }}
          />
        ) : (
          <div className="msg-body text-[14px] break-words whitespace-pre-wrap leading-snug text-left max-h-60 overflow-y-auto">
            {bionicReading ? (
              <BionicText text={displayText} />
            ) : highlightQuery ? (
              highlightText(displayText, highlightQuery)
            ) : (
              displayText
            )}
          </div>
        )
      ) : null}

      {/* Multi-file attachments */}
      {!isDeleted && message.attachments && message.attachments.length > 0 && (
        <AttachmentGrid attachments={message.attachments} ticketId={message.ticketId} />
      )}

      {/* Legacy single image — backward compat */}
      {!isDeleted && !message.attachments && message.mediaUrl && (message.mediaUrl.startsWith('/uploads/') || message.mediaUrl.startsWith('/api/v1/uploads/')) && (() => {
        const url = message.mediaUrl!;
        const filename = url.split('/').pop() || 'file';
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const isImageExt = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext);

        if (isImageExt) {
          return (
            <button
              type="button"
              onClick={() => useStore.getState().openLightbox([{ url, name: filename }], 0)}
              className="mt-2 block rounded-[var(--radius-bubble)] overflow-hidden shadow-[var(--shadow-soft)] cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            >
              <img src={url} alt="attachment" className="w-full h-auto object-cover max-h-96" referrerPolicy="no-referrer" />
            </button>
          );
        }

        const fileLabel = getFileTypeLabel(ext);
        return (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex items-center gap-2.5 px-3 py-2 bg-[var(--color-bg-surface)] rounded-[var(--radius-btn)] shadow-[var(--shadow-soft)] hover:bg-[var(--color-hover)]"
          >
            <FileText size={20} strokeWidth={1.5} className="text-[var(--color-accent)] shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-[13px] font-medium text-[var(--color-ink)] truncate">{filename}</span>
              <span className="text-[11px] text-[var(--color-ink-muted)]">{fileLabel}</span>
            </div>
          </a>
        );
      })()}

      {/* Link previews */}
      {!isDeleted && message.linkPreviews && message.linkPreviews.length > 0 && (
        <div className="flex flex-col gap-1">
          {message.linkPreviews.map((preview) => (
            <LinkPreviewCard key={preview.url} {...preview} />
          ))}
        </div>
      )}
    </>
  );
}

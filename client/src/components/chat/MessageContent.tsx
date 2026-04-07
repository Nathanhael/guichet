import BionicText from '../BionicText';
import { Message } from '../../types';
import AttachmentGrid from './AttachmentGrid';
import QuoteBlock from './QuoteBlock';
import LinkPreviewCard from './LinkPreviewCard';
import { hasMarkdownSyntax, renderMarkdown } from '../../utils/markdown';
import { getFileTypeLabel } from '../../utils/fileUtils';
import { FileText } from 'lucide-react';
import { highlightText } from '../../utils/highlightText';

interface MessageContentProps {
  message: Message;
  displayText: string;
  isDeleted: boolean;
  isMine: boolean;
  isWhisper: boolean;
  bionicReading: boolean;
  translationEnabled: boolean;
  translated: string | null;
  showOriginal: boolean;
  setShowOriginal: (v: boolean) => void;
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
      {message.replyTo && (
        <QuoteBlock
          senderName={message.replyTo.senderName}
          text={message.replyTo.text}
          isDeleted={!message.replyTo.text && !message.replyTo.mediaUrl}
          onClick={() => {
            const el = document.getElementById(`msg-${message.replyTo!.id}`);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.classList.add('bg-accent-blue/10');
              setTimeout(() => el.classList.remove('bg-accent-blue/10'), 1000);
            }
          }}
        />
      )}

      {/* Text content: markdown / bionic / plain */}
      {!isDeleted && displayText.trim() && displayText.trim() !== '[attachment]' ? (
        !bionicReading && hasMarkdownSyntax(displayText) ? (
          <div
            className="msg-markdown text-[13px] break-words leading-snug text-left max-h-60 overflow-y-auto"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(displayText) }}
          />
        ) : (
          <div className="text-[14px] break-words whitespace-pre-wrap leading-snug text-left max-h-60 overflow-y-auto">
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
        <AttachmentGrid attachments={message.attachments} />
      )}

      {/* Legacy single image — backward compat */}
      {!isDeleted && !message.attachments && message.mediaUrl && (message.mediaUrl.startsWith('/uploads/') || message.mediaUrl.startsWith('/api/v1/uploads/')) && (() => {
        const url = message.mediaUrl!;
        const filename = url.split('/').pop() || 'file';
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const isImageExt = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext);

        if (isImageExt) {
          return (
            <div className="mt-2 border border-border">
              <img src={url} alt="attachment" className="w-full h-auto object-cover max-h-96" referrerPolicy="no-referrer" />
            </div>
          );
        }

        const fileLabel = getFileTypeLabel(ext, 'uppercase');
        return (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex items-center gap-2.5 px-3 py-2 border border-border bg-bg-surface hover:bg-bg-elevated"
          >
            <FileText size={20} strokeWidth={1.5} className="text-accent-blue shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-[12px] font-mono font-bold text-text-primary truncate">{filename}</span>
              <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-text-muted">{fileLabel}</span>
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

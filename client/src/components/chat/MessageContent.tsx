import BionicText from '../BionicText';
import { Message } from '../../types';
import AttachmentGrid from './AttachmentGrid';
import QuoteBlock from './QuoteBlock';
import LinkPreviewCard from './LinkPreviewCard';
import { hasMarkdownSyntax, renderMarkdown } from '../../utils/markdown';
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

        const fileLabel = ext === 'pdf' ? 'PDF' : ext === 'docx' || ext === 'doc' ? 'Word' : ext === 'xlsx' || ext === 'xls' ? 'Excel' : ext === 'csv' ? 'CSV' : ext === 'txt' ? 'Text' : ext.toUpperCase();
        return (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex items-center gap-2.5 px-3 py-2 border border-border bg-bg-surface hover:bg-bg-elevated"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-accent-blue shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
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

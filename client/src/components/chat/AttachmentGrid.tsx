import { FileText, Sheet, File, Download } from 'lucide-react';

interface Attachment {
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

interface AttachmentGridProps {
  attachments: Attachment[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(mime: string): boolean {
  return mime.startsWith('image/');
}

function getFileIcon(mime: string) {
  if (mime === 'application/pdf') return <FileText size={20} className="text-[var(--color-accent)] shrink-0" />;
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv' || mime === 'application/csv')
    return <Sheet size={20} className="text-[var(--color-accent)] shrink-0" />;
  return <File size={20} className="text-[var(--color-accent)] shrink-0" />;
}

function getFileLabel(mime: string): string {
  if (mime === 'application/pdf') return 'PDF';
  if (mime === 'application/msword' || mime.includes('wordprocessingml')) return 'Word';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'Excel';
  if (mime === 'text/csv' || mime === 'application/csv') return 'CSV';
  if (mime === 'text/plain') return 'Text';
  return 'File';
}

export default function AttachmentGrid({ attachments }: AttachmentGridProps) {
  const images = attachments.filter(a => isImage(a.mimeType));
  const documents = attachments.filter(a => !isImage(a.mimeType));

  return (
    <div className="mt-2 flex flex-col gap-2">
      {/* Image grid */}
      {images.length > 0 && (
        <div className={`grid gap-1 ${
          images.length === 1 ? 'grid-cols-1 max-w-[300px]' :
          'grid-cols-2'
        }`}>
          {images.map((img) => (
            <a
              key={img.url}
              href={img.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-[var(--radius-bubble)] overflow-hidden shadow-[var(--shadow-soft)]"
            >
              <img
                src={img.url}
                alt={img.name}
                className="w-full h-auto object-cover max-h-60"
                referrerPolicy="no-referrer"
              />
            </a>
          ))}
        </div>
      )}

      {/* Document cards */}
      {documents.map((doc) => (
        <a
          key={doc.url}
          href={doc.url}
          target="_blank"
          rel="noopener noreferrer"
          download={doc.name}
          className="flex items-center gap-2.5 px-3 py-2 bg-[var(--color-bg-surface)] rounded-[var(--radius-btn)] shadow-[var(--shadow-soft)] hover:bg-[var(--color-hover)]"
        >
          {getFileIcon(doc.mimeType)}
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-[13px] font-medium text-[var(--color-ink)] truncate">{doc.name}</span>
            <span className="text-[11px] text-[var(--color-ink-muted)]">
              {getFileLabel(doc.mimeType)} · {formatSize(doc.size)}
            </span>
          </div>
          <Download size={14} className="text-[var(--color-ink-muted)] shrink-0" />
        </a>
      ))}
    </div>
  );
}

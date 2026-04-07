import { useT } from '../../i18n';

interface QuoteBlockProps {
  senderName: string;
  text: string;
  isDeleted?: boolean;
  onClick?: () => void;
}

export default function QuoteBlock({ senderName, text, isDeleted, onClick }: QuoteBlockProps) {
  const t = useT();
  return (
    <div
      onClick={onClick}
      className={`border-l-[3px] border-accent-blue pl-2 py-1 mb-1.5 bg-bg-elevated ${onClick ? 'cursor-pointer hover:bg-bg-surface' : ''}`}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="font-mono text-[9px] font-bold text-accent-blue truncate">{senderName}</div>
      <div className="text-[11px] text-text-secondary truncate">
        {isDeleted ? <em className="text-text-muted">{t('message_deleted') || 'Message deleted'}</em> : (text || '[Attachment]')}
      </div>
    </div>
  );
}

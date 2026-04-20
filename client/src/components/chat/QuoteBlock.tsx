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
      className={`border-l-[3px] border-[var(--color-accent)] pl-2.5 py-1 mb-1.5 rounded-r-[var(--radius-btn)] bg-[var(--color-bg-elevated)] ${
        onClick ? 'cursor-pointer hover:bg-[var(--color-hover)]' : ''
      }`}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="text-[11px] font-semibold text-[var(--color-accent)] truncate">{senderName}</div>
      <div className="text-[12px] text-[var(--color-ink-soft)] truncate">
        {isDeleted ? <em className="text-[var(--color-ink-muted)]">{t('message_deleted') || 'Message deleted'}</em> : (text || '[Attachment]')}
      </div>
    </div>
  );
}

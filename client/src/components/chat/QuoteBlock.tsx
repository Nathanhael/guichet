import { useEffect } from 'react';
import { useT } from '../../i18n';
import { useAutoTranslation } from '../../hooks/useTranslation';

interface QuoteBlockProps {
  /** Parent message ID — used as the translation cache key when translating. */
  parentMessageId?: string;
  senderName: string;
  senderLang?: string | null;
  text: string;
  isDeleted?: boolean;
  /** Viewer's UI language (from `users.lang`). Translation only fires when
   *  this is set AND the parent message's senderLang differs. */
  viewerLang?: string;
  /** Per-partner AI translation gate. */
  translationEnabled?: boolean;
  onClick?: () => void;
}

export default function QuoteBlock({
  parentMessageId,
  senderName,
  senderLang,
  text,
  isDeleted,
  viewerLang,
  translationEnabled,
  onClick,
}: QuoteBlockProps) {
  const t = useT();

  // Reuse the same auto-translation hook as the bubble body so the Redis
  // cache key (`translation:${id}:${lang}`) is shared — when the parent
  // message is also rendered in the visible message list, the call hits
  // the cache instantly. Hook always runs (rules-of-hooks) but stays a
  // no-op when no senderLang/viewerLang/messageId is supplied.
  const { translated, translate, needsTranslation } = useAutoTranslation({
    messageId: parentMessageId ?? '',
    text,
    senderLang: senderLang ?? '',
    viewerLang: viewerLang ?? '',
    enabled: !!translationEnabled && !!parentMessageId && !isDeleted,
  });

  useEffect(() => {
    if (needsTranslation) translate();
  }, [needsTranslation, translate]);

  const displayText = translated ?? text;

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
        {isDeleted ? <em className="text-[var(--color-ink-muted)]">{t('message_deleted')}</em> : (displayText || '[Attachment]')}
      </div>
    </div>
  );
}

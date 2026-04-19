interface LangBadgeProps {
  lang: string | null | undefined;
  viewerLang: string;
  className?: string;
}

/**
 * 2-letter language chip for queue rows and headers. When the ticket language
 * differs from the viewer's language, the badge is drawn in accent-blue so the
 * eye catches cross-lang tickets at a glance; same-lang badges render muted.
 */
export default function LangBadge({ lang, viewerLang, className }: LangBadgeProps) {
  if (!lang) return null;
  const isCrossLang = lang !== viewerLang;
  const colorClass = isCrossLang
    ? 'border-[var(--color-accent-blue)] text-[var(--color-accent-blue)]'
    : 'border-[var(--color-border)] text-[var(--color-text-muted)]';
  return (
    <span
      data-lang-badge={lang}
      data-cross-lang={isCrossLang ? 'true' : 'false'}
      className={`font-mono text-[8px] font-bold uppercase tracking-[0.5px] px-[4px] py-px border shrink-0 ${colorClass} ${className ?? ''}`}
    >
      {lang.toUpperCase()}
    </span>
  );
}

interface LangBadgeProps {
  lang: string | null | undefined;
  viewerLang: string;
  className?: string;
}

export default function LangBadge({ lang, viewerLang, className }: LangBadgeProps) {
  if (!lang) return null;
  const isCrossLang = lang !== viewerLang;
  const colorClass = isCrossLang
    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
    : 'border-[var(--color-border)] text-[var(--color-ink-muted)]';
  return (
    <span
      data-lang-badge={lang}
      data-cross-lang={isCrossLang ? 'true' : 'false'}
      className={`inline-flex items-center rounded-[var(--radius-pill)] text-[10px] font-semibold px-1.5 py-0.5 border leading-none shrink-0 ${colorClass} ${className ?? ''}`}
    >
      {lang.toUpperCase()}
    </span>
  );
}

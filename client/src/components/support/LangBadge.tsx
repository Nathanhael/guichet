import { ROW_PILL_ACCENT, ROW_PILL_MUTED } from './supportStyles';

interface LangBadgeProps {
  lang: string | null | undefined;
  viewerLang: string;
  className?: string;
}

export default function LangBadge({ lang, viewerLang, className }: LangBadgeProps) {
  if (!lang) return null;
  const isCrossLang = lang !== viewerLang;
  const pillClass = isCrossLang ? ROW_PILL_ACCENT : ROW_PILL_MUTED;
  return (
    <span
      data-lang-badge={lang}
      data-cross-lang={isCrossLang ? 'true' : 'false'}
      className={`${pillClass} ${className ?? ''}`}
    >
      {lang.toUpperCase()}
    </span>
  );
}

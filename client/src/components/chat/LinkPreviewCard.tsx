import { Link2 } from 'lucide-react';

interface LinkPreviewCardProps {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

function isSafeUrl(u: string): boolean {
  try {
    const parsed = new URL(u, window.location.origin);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export default function LinkPreviewCard({ url, title, description, image, siteName }: LinkPreviewCardProps) {
  if (!title && !description) return null;
  const safeHref = isSafeUrl(url) ? url : undefined;
  const safeImage = image && isSafeUrl(image) ? image : undefined;
  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 p-2 mt-1.5 no-underline bg-[var(--color-bg-elevated)] rounded-[var(--radius-btn)] shadow-[var(--shadow-soft)] hover:bg-[var(--color-hover)]"
    >
      <div className="w-[60px] h-[60px] shrink-0 bg-[var(--color-bg-surface)] rounded-[var(--radius-btn)] flex items-center justify-center overflow-hidden">
        {safeImage ? (
          <img
            src={safeImage}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <Link2 size={20} className="text-[var(--color-ink-muted)]" />
        )}
      </div>
      <div className="flex flex-col justify-center min-w-0 flex-1">
        {siteName && (
          <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-muted)] truncate">{siteName}</span>
        )}
        {title && (
          <span className="font-semibold text-[13px] text-[var(--color-ink)] truncate">{title}</span>
        )}
        {description && (
          <span className="text-[12px] text-[var(--color-ink-soft)] line-clamp-2">{description}</span>
        )}
      </div>
    </a>
  );
}

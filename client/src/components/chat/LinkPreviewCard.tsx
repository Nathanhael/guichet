import { Link2 } from 'lucide-react';

interface LinkPreviewCardProps {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

export default function LinkPreviewCard({ url, title, description, image, siteName }: LinkPreviewCardProps) {
  if (!title && !description) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 bg-bg-elevated border border-border p-2 mt-1.5 hover:bg-bg-surface no-underline"
    >
      <div className="w-[60px] h-[60px] shrink-0 bg-bg-surface border border-border flex items-center justify-center overflow-hidden">
        {image ? (
          <img
            src={image}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <Link2 size={20} className="text-text-secondary" />
        )}
      </div>
      <div className="flex flex-col justify-center min-w-0 flex-1">
        {siteName && (
          <span className="font-mono text-[8px] uppercase tracking-widest text-text-secondary truncate">{siteName}</span>
        )}
        {title && (
          <span className="font-bold text-[12px] text-text-primary truncate">{title}</span>
        )}
        {description && (
          <span className="text-[11px] text-text-secondary line-clamp-2">{description}</span>
        )}
      </div>
    </a>
  );
}

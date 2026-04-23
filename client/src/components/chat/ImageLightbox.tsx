import { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import useStore from '../../store/useStore';

export default function ImageLightbox() {
  const images = useStore((s) => s.lightboxImages);
  const index = useStore((s) => s.lightboxIndex);
  const closeLightbox = useStore((s) => s.closeLightbox);
  const navigateLightbox = useStore((s) => s.navigateLightbox);

  const isOpen = index !== null && images.length > 0;
  const current = isOpen ? images[index] : null;
  const hasMany = images.length > 1;

  const onPrev = useCallback(() => navigateLightbox(-1), [navigateLightbox]);
  const onNext = useCallback(() => navigateLightbox(1), [navigateLightbox]);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft' && hasMany) onPrev();
      else if (e.key === 'ArrowRight' && hasMany) onNext();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, hasMany, closeLightbox, onPrev, onNext]);

  if (!isOpen || !current) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.name}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 animate-[fade-in_150ms_ease-out]"
      onClick={closeLightbox}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); closeLightbox(); }}
        aria-label="Close"
        className="absolute top-4 right-4 flex items-center justify-center h-10 w-10 rounded-full bg-black/40 text-white/90 hover:bg-black/60 hover:text-white transition-colors"
      >
        <X size={20} />
      </button>

      <a
        href={current.url}
        download={current.name}
        onClick={(e) => e.stopPropagation()}
        aria-label="Download image"
        className="absolute top-4 right-16 flex items-center justify-center h-10 w-10 rounded-full bg-black/40 text-white/90 hover:bg-black/60 hover:text-white transition-colors"
      >
        <Download size={18} />
      </a>

      {hasMany && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPrev(); }}
            aria-label="Previous image"
            className="absolute left-4 flex items-center justify-center h-12 w-12 rounded-full bg-black/40 text-white/90 hover:bg-black/60 hover:text-white transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onNext(); }}
            aria-label="Next image"
            className="absolute right-4 flex items-center justify-center h-12 w-12 rounded-full bg-black/40 text-white/90 hover:bg-black/60 hover:text-white transition-colors"
          >
            <ChevronRight size={24} />
          </button>
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[12px] text-white/80 px-3 py-1 rounded-full bg-black/40 select-none">
            {index + 1} / {images.length}
          </span>
        </>
      )}

      <img
        src={current.url}
        alt={current.name}
        onClick={(e) => e.stopPropagation()}
        referrerPolicy="no-referrer"
        className="max-w-[92vw] max-h-[88vh] object-contain rounded-[var(--radius-card)] shadow-[var(--shadow-modal)]"
      />
    </div>,
    document.body,
  );
}

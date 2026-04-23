import { useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import useStore from '../../store/useStore';

// Attachment URLs come from the server and should always resolve to the same
// origin (either `/uploads/<file>` for local storage, or an origin-rewritten
// proxy path for object storage). Reject anything cross-origin so a bad
// attachment record can't redirect the Download anchor offsite — the
// `download` attribute is ignored by browsers on cross-origin hrefs, so a
// malicious URL there becomes a plain navigation.
function isSafeAttachmentUrl(url: string): boolean {
  try {
    if (url.startsWith('/') && !url.startsWith('//')) return true;
    const u = new URL(url, window.location.origin);
    return u.origin === window.location.origin;
  } catch {
    return false;
  }
}

export default function ImageLightbox() {
  const images = useStore((s) => s.lightboxImages);
  const index = useStore((s) => s.lightboxIndex);
  const closeLightbox = useStore((s) => s.closeLightbox);
  const navigateLightbox = useStore((s) => s.navigateLightbox);

  const isOpen = index !== null && images.length > 0;
  const current = isOpen ? images[index] : null;
  const hasMany = images.length > 1;
  const safe = !!current && isSafeAttachmentUrl(current.url);

  const dialogRef = useRef<HTMLDivElement | null>(null);

  const onPrev = useCallback(() => navigateLightbox(-1), [navigateLightbox]);
  const onNext = useCallback(() => navigateLightbox(1), [navigateLightbox]);

  // Focus trap — on open, remember the previously focused element, move
  // focus into the dialog, and restore on close. Tab/Shift+Tab wrap around
  // the dialog's own focusable descendants so keyboard users can't escape
  // into the chat underneath while the modal is up.
  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.focus();

    function getFocusable(): HTMLElement[] {
      if (!dialog) return [];
      return Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { closeLightbox(); return; }
      if (e.key === 'ArrowLeft' && hasMany) { onPrev(); return; }
      if (e.key === 'ArrowRight' && hasMany) { onNext(); return; }
      if (e.key === 'Tab') {
        const focusable = getFocusable();
        if (focusable.length === 0) { e.preventDefault(); return; }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || !dialog?.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [isOpen, hasMany, closeLightbox, onPrev, onNext]);

  // Close automatically if a cross-origin URL sneaks in — don't render a
  // dialog around content we refuse to display.
  useEffect(() => {
    if (isOpen && current && !safe) closeLightbox();
  }, [isOpen, current, safe, closeLightbox]);

  if (!isOpen || !current || !safe) return null;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={current.name}
      tabIndex={-1}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 animate-[fade-in_150ms_ease-out] outline-none"
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

import { X } from 'lucide-react';
import { useT } from '../i18n';

interface LegalModalProps {
  type: 'privacy' | 'terms';
  onClose: () => void;
}

const PRIVACY_SECTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const TERMS_SECTIONS = [1, 2, 3, 4, 5, 6, 7] as const;

export default function LegalModal({ type, onClose }: LegalModalProps) {
  const t = useT();

  const title = type === 'privacy' ? t('privacy_policy') : t('terms_of_service');
  const sections =
    type === 'privacy'
      ? PRIVACY_SECTIONS.map((n) => ({
          title: t(`legal_privacy_s${n}_title`),
          body: t(`legal_privacy_s${n}_body`),
        }))
      : TERMS_SECTIONS.map((n) => ({
          title: t(`legal_terms_s${n}_title`),
          body: t(`legal_terms_s${n}_body`),
        }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-base/80"
      onClick={onClose}
    >
      <div
        role="dialog" aria-modal="true" className="relative flex flex-col w-full max-w-2xl max-h-[85vh] bg-bg-surface border border-border-heavy overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="sticky top-0 z-10 flex items-start justify-between px-6 py-4 bg-bg-elevated border-b border-border">
          <div>
            <h2 className="text-base font-bold uppercase tracking-widest text-text-primary">
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              {t('legal_last_updated')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 mt-0.5 text-text-secondary hover:text-text-primary"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {sections.map((section, index) => (
            <div key={index}>
              <h3 className="text-xs font-bold uppercase tracking-widest text-text-primary mb-2">
                {index + 1}. {section.title}
              </h3>
              <p className="text-sm leading-relaxed whitespace-pre-line text-text-secondary">
                {section.body}
              </p>
            </div>
          ))}

          {/* Footer */}
          <p className="text-xs text-text-muted border-t border-border pt-4">
            {t('legal_footer')}
          </p>
        </div>
      </div>
    </div>
  );
}

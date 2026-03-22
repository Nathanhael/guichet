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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-white/20"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-full max-w-2xl max-h-[85vh] bg-white dark:bg-black border-2 border-black dark:border-white overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="sticky top-0 z-10 flex items-start justify-between px-6 py-4 bg-black dark:bg-white">
          <div>
            <h2 className="text-base font-black uppercase tracking-widest text-white dark:text-black">
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-white/70 dark:text-black/70">
              {t('legal_last_updated')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 mt-0.5 text-white dark:text-black"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {sections.map((section, index) => (
            <div key={index}>
              <h3 className="text-xs font-black uppercase tracking-widest text-black dark:text-white mb-2">
                {index + 1}. {section.title}
              </h3>
              <p className="text-sm leading-relaxed opacity-80 whitespace-pre-line text-black dark:text-white">
                {section.body}
              </p>
            </div>
          ))}

          {/* Footer */}
          <p className="text-xs opacity-60 text-black dark:text-white border-t border-black dark:border-white pt-4">
            {t('legal_footer')}
          </p>
        </div>
      </div>
    </div>
  );
}

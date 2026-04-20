import { useT } from '../i18n';
import Modal, { ModalHeader } from './ui/Modal';

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
    <Modal open={true} onClose={onClose} id="legal-modal" maxWidth={720}>
      <div className="flex flex-col max-h-[85vh]">
        <ModalHeader
          title={title}
          subtitle={t('legal_last_updated')}
          onClose={onClose}
        />
        <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-6">
          {sections.map((section, index) => (
            <div key={index}>
              <h3 className="text-[13px] font-semibold text-[var(--color-ink)] mb-2">
                {index + 1}. {section.title}
              </h3>
              <p className="text-[13px] leading-relaxed whitespace-pre-line text-[var(--color-ink-soft)]">
                {section.body}
              </p>
            </div>
          ))}
          <p className="text-[12px] text-[var(--color-ink-muted)] border-t border-[var(--color-border)] pt-4">
            {t('legal_footer')}
          </p>
        </div>
      </div>
    </Modal>
  );
}

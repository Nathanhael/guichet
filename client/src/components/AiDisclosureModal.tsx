import { useT } from '../i18n';
import Modal, { ModalBody, ModalFooter, ModalHeader } from './ui/Modal';
import Button from './ui/Button';

/**
 * Worker-facing in-app summary of the works-council disclosure that the
 * partner is expected to present to the CE / CPPT before enabling AI
 * features. Lives next to the "Anonymize my AI usage" toggle so the
 * worker can understand what they are opting out of (and what stays in
 * place regardless of the opt-out).
 *
 * The full legal template ships as docs/WORKS_COUNCIL_DISCLOSURE.md —
 * this modal is the short, readable summary. Keep it short; if it grows
 * past one screen on a 720p laptop, split it instead.
 */
export interface AiDisclosureModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AiDisclosureModal({ open, onClose }: AiDisclosureModalProps) {
  const t = useT();
  return (
    <Modal open={open} onClose={onClose} id="ai-disclosure" maxWidth={560}>
      <ModalHeader title={t('ai_disclosure_modal_title')} onClose={onClose} />
      <ModalBody className="space-y-3 max-h-[60vh] overflow-y-auto">
        <p>{t('ai_disclosure_modal_intro')}</p>

        <section>
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] mt-2 mb-1">
            {t('ai_disclosure_modal_logged_title')}
          </h3>
          <ul className="list-disc pl-5 space-y-0.5">
            <li>{t('ai_disclosure_modal_logged_when')}</li>
            <li>{t('ai_disclosure_modal_logged_action')}</li>
            <li>{t('ai_disclosure_modal_logged_tokens')}</li>
          </ul>
        </section>

        <section>
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] mt-2 mb-1">
            {t('ai_disclosure_modal_not_logged_title')}
          </h3>
          <ul className="list-disc pl-5 space-y-0.5">
            <li>{t('ai_disclosure_modal_not_logged_pii')}</li>
            <li>{t('ai_disclosure_modal_not_logged_content')}</li>
          </ul>
        </section>

        <section>
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] mt-2 mb-1">
            {t('ai_disclosure_modal_rights_title')}
          </h3>
          <p>{t('ai_disclosure_modal_rights_body')}</p>
        </section>

        <p className="text-[11px] text-[var(--color-ink-muted)] italic">
          {t('ai_disclosure_modal_retention')}
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={onClose}>
          {t('ai_disclosure_modal_ack')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/**
 * Platform AI Security defaults panel (slice 10.6 of the AI rollout).
 *
 * Two global toggles that apply to every partner unless overridden:
 *   - PII Redaction: 'on' (strip emails/phones/IDs before AI calls) | 'off'
 *   - Audit Verbosity: 'metadata' (default) | 'full' (debug)
 *
 * Per-partner overrides are configured in EditPartnerModal but enforced
 * "stricter only" — partner cannot weaken the platform setting (decision 22).
 * That enforcement lives in the partner config router, not here.
 */
import { useEffect, useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import Button from '../ui/Button';
import Toast from '../Toast';

const CARD =
  'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)]';
const FIELD_LABEL = 'block text-[12px] font-medium text-[var(--color-ink-soft)] mb-2';
const SECTION_TITLE = 'text-[15px] font-semibold tracking-[-0.1px] text-[var(--color-ink)]';
const SECTION_HINT = 'text-[12px] text-[var(--color-ink-muted)] mt-0.5';

type PiiRedaction = 'on' | 'off';
type AuditVerbosity = 'metadata' | 'full';

export default function PlatformSecurity() {
  const t = useT();
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.platform.getAiSecurityDefaults.useQuery();
  const [pii, setPii] = useState<PiiRedaction>('on');
  const [audit, setAudit] = useState<AuditVerbosity>('metadata');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Hydrate radios from server response.
  useEffect(() => {
    if (data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPii(data.piiRedaction);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAudit(data.auditVerbosity);
    }
  }, [data]);

  const saveMutation = trpc.platform.setAiSecurityDefaults.useMutation({
    onSuccess: () => {
      setToast({ message: t('ai_security_saved_toast'), type: 'success' });
      utils.platform.getAiSecurityDefaults.invalidate();
    },
    onError: (err) => {
      setToast({ message: err.message || t('ai_security_save_error'), type: 'error' });
    },
  });

  const handleSave = () => {
    saveMutation.mutate({ piiRedaction: pii, auditVerbosity: audit });
  };

  if (isLoading) {
    return (
      <div data-testid="platform-security-loading" className="py-12 text-center text-[13px] text-[var(--color-ink-muted)]">
        Loading…
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-[17px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">
          {t('platform_tab_ai_security')}
        </h2>
        <p className="text-[13px] text-[var(--color-ink-muted)] mt-1">
          {t('ai_security_panel_desc')}
        </p>
      </div>

      <div className={`${CARD} p-6 mb-6`}>
        <div className="mb-3">
          <div className={SECTION_TITLE}>{t('ai_security_pii_label')}</div>
          <div className={SECTION_HINT}>{t('ai_security_pii_hint')}</div>
        </div>
        <fieldset>
          <legend className={FIELD_LABEL}>{t('ai_security_pii_label')}</legend>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[13px] cursor-pointer">
              <input
                type="radio"
                name="pii-redaction"
                value="on"
                checked={pii === 'on'}
                onChange={() => setPii('on')}
                className="h-3.5 w-3.5 accent-[var(--color-accent)]"
              />
              <span className="text-[var(--color-ink)]">{t('ai_security_pii_on')}</span>
            </label>
            <label className="flex items-center gap-2 text-[13px] cursor-pointer">
              <input
                type="radio"
                name="pii-redaction"
                value="off"
                checked={pii === 'off'}
                onChange={() => setPii('off')}
                className="h-3.5 w-3.5 accent-[var(--color-accent)]"
              />
              <span className="text-[var(--color-ink)]">{t('ai_security_pii_off')}</span>
            </label>
          </div>
        </fieldset>
      </div>

      <div className={`${CARD} p-6 mb-6`}>
        <div className="mb-3">
          <div className={SECTION_TITLE}>{t('ai_security_audit_label')}</div>
          <div className={SECTION_HINT}>{t('ai_security_audit_hint')}</div>
        </div>
        <fieldset>
          <legend className={FIELD_LABEL}>{t('ai_security_audit_label')}</legend>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[13px] cursor-pointer">
              <input
                type="radio"
                name="audit-verbosity"
                value="metadata"
                checked={audit === 'metadata'}
                onChange={() => setAudit('metadata')}
                className="h-3.5 w-3.5 accent-[var(--color-accent)]"
              />
              <span className="text-[var(--color-ink)]">{t('ai_security_audit_metadata')}</span>
            </label>
            <label className="flex items-center gap-2 text-[13px] cursor-pointer">
              <input
                type="radio"
                name="audit-verbosity"
                value="full"
                checked={audit === 'full'}
                onChange={() => setAudit('full')}
                className="h-3.5 w-3.5 accent-[var(--color-accent)]"
              />
              <span className="text-[var(--color-ink)]">{t('ai_security_audit_full')}</span>
            </label>
          </div>
        </fieldset>
      </div>

      <div className="flex justify-end">
        <Button
          variant="primary"
          size="md"
          onClick={handleSave}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? '…' : t('ai_security_save')}
        </Button>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

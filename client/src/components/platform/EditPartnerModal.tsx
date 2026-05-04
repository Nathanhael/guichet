import { useState, useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import FormModal, { FIELD_LABEL, INPUT } from '../ui/FormModal';
import type { Partner, AiFeatures, ImprovementMode } from './types';

interface EditPartnerModalProps {
  partner: Partner | null;
  onClose: () => void;
}

const BOOLEAN_FEATURES: { key: Exclude<keyof AiFeatures, 'messageImprovement'>; label: string; description: string }[] = [
  { key: 'translation', label: 'Auto-Translation', description: 'Automatically translate messages between nl/en/fr based on user language' },
  { key: 'queueLangAwareness', label: 'Queue Language Awareness', description: 'Show per-language staffing header + cross-lang banner; pre-warm translations for cross-lang tickets' },
  { key: 'voiceTranscription', label: 'Voice Transcription', description: 'Support staff can dictate replies via microphone (Azure Whisper)' },
  { key: 'cannedTranslation', label: 'Canned Translation', description: 'Auto-translate canned responses to nl/fr/en at write-time; admin-editable' },
];

const IMPROVEMENT_OPTIONS: { value: ImprovementMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'optional', label: 'Optional' },
  { value: 'forced', label: 'Forced' },
];

const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]';

function Toggle({ on, onToggle, size = 'md', label }: { on: boolean; onToggle: () => void; size?: 'sm' | 'md'; label: string }) {
  const track = size === 'sm' ? 'w-9 h-5' : 'w-11 h-6';
  const thumb = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  const slide = size === 'sm' ? (on ? 'left-[18px]' : 'left-0.5') : (on ? 'left-[22px]' : 'left-0.5');
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-pressed={on}
      className={`relative ${track} rounded-full transition-colors shrink-0 ${
        on ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-bg-elevated)] border border-[var(--color-border-strong)]'
      }`}
    >
      <span
        className={`absolute top-1/2 -translate-y-1/2 ${thumb} ${slide} rounded-full bg-white shadow-[var(--shadow-soft)] transition-[left] duration-150`}
      />
    </button>
  );
}

type PiiOverride = 'on' | 'off' | null;
type AuditOverride = 'metadata' | 'full' | null;

export default function EditPartnerModal({ partner, onClose }: EditPartnerModalProps) {
  const t = useT();
  const utils = trpc.useUtils();
  const [form, setForm] = useState<{
    name: string;
    aiEnabled: boolean;
    aiFeatures: AiFeatures;
    aiFeaturesAvailable: AiFeatures;
    whisperDeployment: string;
    aiPiiRedaction: PiiOverride;
    aiAuditVerbosity: AuditOverride;
  }>({ name: '', aiEnabled: false, aiFeatures: {}, aiFeaturesAvailable: {}, whisperDeployment: '', aiPiiRedaction: null, aiAuditVerbosity: null });

  // Hydrate the form when the modal opens onto a partner (prop→state sync).
  useEffect(() => {
    if (partner) {
      const raw = (partner.aiFeatures ?? {}) as AiFeatures;
      let improvement: ImprovementMode = 'off';
      if ((raw as Record<string, unknown>).messageImprovement === true || raw.messageImprovement === 'optional') improvement = 'optional';
      else if (raw.messageImprovement === 'forced') improvement = 'forced';
      else if (typeof raw.messageImprovement === 'string') improvement = raw.messageImprovement as ImprovementMode;

      const aiConfig = ((partner as Record<string, unknown>).aiConfig ?? {}) as { whisperDeployment?: string };
      const envelope = ((partner as Record<string, unknown>).aiFeaturesAvailable ?? {}) as AiFeatures;
      const partnerRecord = partner as Record<string, unknown>;
      const piiRaw = partnerRecord.aiPiiRedaction;
      const piiOverride: PiiOverride = piiRaw === 'on' || piiRaw === 'off' ? piiRaw : null;
      const auditRaw = partnerRecord.aiAuditVerbosity;
      const auditOverride: AuditOverride = auditRaw === 'metadata' || auditRaw === 'full' ? auditRaw : null;

      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({
        name: partner.name,
        aiEnabled: partner.aiEnabled ?? false,
        aiFeatures: { ...raw, messageImprovement: improvement },
        aiFeaturesAvailable: envelope,
        whisperDeployment: aiConfig.whisperDeployment ?? '',
        aiPiiRedaction: piiOverride,
        aiAuditVerbosity: auditOverride,
      });
    }
  }, [partner]);

  const updatePartner = trpc.platform.updatePartner.useMutation();

  function toggleFeature(key: Exclude<keyof AiFeatures, 'messageImprovement'>) {
    setForm(prev => ({
      ...prev,
      aiFeatures: { ...prev.aiFeatures, [key]: !prev.aiFeatures[key] },
    }));
  }

  function toggleEnvelope(key: Exclude<keyof AiFeatures, 'messageImprovement'>) {
    setForm(prev => ({
      ...prev,
      aiFeaturesAvailable: { ...prev.aiFeaturesAvailable, [key]: !prev.aiFeaturesAvailable[key] },
    }));
  }

  if (!partner) return null;

  return (
    <FormModal
      open={!!partner}
      onClose={onClose}
      title={form.name || partner.name}
      subtitle={partner.industry || undefined}
      mutation={updatePartner}
      onSubmit={() => ({
        id: partner.id,
        data: {
          name: form.name,
          aiEnabled: form.aiEnabled,
          aiFeatures: form.aiFeatures,
          aiFeaturesAvailable: form.aiFeaturesAvailable,
          aiConfig: { whisperDeployment: form.whisperDeployment },
          aiPiiRedaction: form.aiPiiRedaction,
          aiAuditVerbosity: form.aiAuditVerbosity,
        },
      })}
      submitLabel={t('save_profile')}
      cancelLabel={t('cancel')}
      invalidate={() => utils.platform.listPartners.invalidate()}
      maxWidth={640}
      id="edit-partner"
    >
      <div className="max-h-[70vh] overflow-y-auto">
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={FIELD_LABEL}>{t('display_name')}</label>
              <input
                type="text"
                className={INPUT}
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className={FIELD_LABEL}>{t('id_label')}</label>
              <div className={`${INPUT} font-mono text-[var(--color-ink-muted)] flex items-center cursor-default`}>
                {partner.id}
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-[var(--color-border)]">
            <div className="flex items-center justify-between mt-4 mb-3">
              <h3 className={SECTION_LABEL}>AI Features</h3>
              <Toggle
                on={form.aiEnabled}
                onToggle={() => setForm(prev => ({ ...prev, aiEnabled: !prev.aiEnabled }))}
                label="Toggle AI"
              />
            </div>

            {form.aiEnabled ? (
              <div className="divide-y divide-[var(--color-border)]">
                <div className="flex items-center justify-between py-3 gap-4">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-[var(--color-ink)]">Message Improvement</div>
                    <div className="text-[12px] text-[var(--color-ink-muted)] mt-0.5">AI-powered rewriting of messages for clarity</div>
                  </div>
                  <div className="inline-flex rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] p-0.5 shrink-0">
                    {IMPROVEMENT_OPTIONS.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setForm(prev => ({
                          ...prev,
                          aiFeatures: { ...prev.aiFeatures, messageImprovement: value },
                        }))}
                        className={`px-3 py-1 text-[12px] font-medium rounded-[calc(var(--radius-btn)-2px)] transition-colors ${
                          form.aiFeatures.messageImprovement === value
                            ? 'bg-[var(--color-bg-surface)] text-[var(--color-ink)] shadow-[var(--shadow-soft)]'
                            : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {BOOLEAN_FEATURES.map(({ key, label, description }) => (
                  <div key={key} className="flex items-center justify-between py-3 gap-4">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-[var(--color-ink)]">{label}</div>
                      <div className="text-[12px] text-[var(--color-ink-muted)] mt-0.5">{description}</div>
                    </div>
                    <Toggle
                      size="sm"
                      on={!!form.aiFeatures[key]}
                      onToggle={() => toggleFeature(key)}
                      label={`Toggle ${label}`}
                    />
                  </div>
                ))}

                <div className="py-3">
                  <label className={FIELD_LABEL}>Whisper Deployment</label>
                  <input
                    type="text"
                    className={INPUT}
                    value={form.whisperDeployment}
                    onChange={e => setForm(prev => ({ ...prev, whisperDeployment: e.target.value }))}
                    placeholder="whisper"
                  />
                  <div className="text-[12px] text-[var(--color-ink-muted)] mt-1">Azure deployment name of a Whisper model. Default: <code className="font-mono">whisper</code>.</div>
                </div>

                {/* Slice 10b: feature envelope (platform max). Partner admin
                    cannot enable any feature outside this set. Stricter-only
                    enforcement is on the server (see featuresEnvelope.ts). */}
                <div className="pt-4">
                  <h3 className={SECTION_LABEL}>Feature Envelope (Platform Max)</h3>
                  <p className="text-[12px] text-[var(--color-ink-muted)] mt-1 mb-3">
                    Features the partner admin is allowed to enable. The settings above cannot exceed this envelope.
                  </p>
                  <div className="divide-y divide-[var(--color-border)]">
                    {BOOLEAN_FEATURES.map(({ key, label }) => (
                      <div key={`env-${key}`} className="flex items-center justify-between py-3 gap-4">
                        <div className="text-[13px] font-medium text-[var(--color-ink)]">{label}</div>
                        <Toggle
                          size="sm"
                          on={!!form.aiFeaturesAvailable[key]}
                          onToggle={() => toggleEnvelope(key)}
                          label={`Envelope: ${label}`}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Slice 10c: per-partner security overrides (PII redaction +
                    audit verbosity). Inherit = NULL on the partner column,
                    falling back to the platform-level system_settings default. */}
                <div className="pt-4">
                  <h3 className={SECTION_LABEL}>Security Overrides</h3>
                  <p className="text-[12px] text-[var(--color-ink-muted)] mt-1 mb-3">{t('edit_partner_security_title')}</p>
                  <div className="py-3">
                    <div className="text-[13px] font-medium text-[var(--color-ink)]">{t('edit_partner_pii_label')}</div>
                    <div className="text-[12px] text-[var(--color-ink-muted)] mt-0.5 mb-2">{t('edit_partner_pii_help')}</div>
                    <div className="flex flex-wrap gap-3">
                      {([
                        { value: null, label: 'PII: Inherit' },
                        { value: 'on' as const, label: 'PII: On' },
                        { value: 'off' as const, label: 'PII: Off' },
                      ]).map(({ value, label }) => (
                        <label key={String(value)} className="flex items-center gap-2 text-[12px] text-[var(--color-ink)]">
                          <input
                            type="radio"
                            name="aiPiiRedaction"
                            aria-label={label}
                            checked={form.aiPiiRedaction === value}
                            onChange={() => setForm(prev => ({ ...prev, aiPiiRedaction: value }))}
                          />
                          {value === null ? t('edit_partner_inherit_option') : label.replace('PII: ', '')}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="py-3">
                    <div className="text-[13px] font-medium text-[var(--color-ink)]">{t('edit_partner_audit_label')}</div>
                    <div className="text-[12px] text-[var(--color-ink-muted)] mt-0.5 mb-2">{t('edit_partner_audit_help')}</div>
                    <div className="flex flex-wrap gap-3">
                      {([
                        { value: null, label: 'Audit: Inherit' },
                        { value: 'metadata' as const, label: 'Audit: Metadata' },
                        { value: 'full' as const, label: 'Audit: Full' },
                      ]).map(({ value, label }) => (
                        <label key={String(value)} className="flex items-center gap-2 text-[12px] text-[var(--color-ink)]">
                          <input
                            type="radio"
                            name="aiAuditVerbosity"
                            aria-label={label}
                            checked={form.aiAuditVerbosity === value}
                            onChange={() => setForm(prev => ({ ...prev, aiAuditVerbosity: value }))}
                          />
                          {value === null ? t('edit_partner_inherit_option') : label.replace('Audit: ', '')}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-[var(--color-ink-muted)] italic">AI is disabled for this tenant. Enable the toggle above to configure individual features.</p>
            )}
          </div>
        </div>
      </div>
    </FormModal>
  );
}

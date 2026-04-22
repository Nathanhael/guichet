import { useState, useEffect, useCallback } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import Toast from '../Toast';
import Modal, { ModalHeader, ModalBody, ModalFooter } from '../ui/Modal';
import Button from '../ui/Button';
import type { Partner, AiFeatures, ImprovementMode } from './types';

interface EditPartnerModalProps {
  partner: Partner | null;
  onClose: () => void;
}

const BOOLEAN_FEATURES: { key: Exclude<keyof AiFeatures, 'messageImprovement'>; label: string; description: string }[] = [
  { key: 'chatSummarization', label: 'Chat Summarization', description: 'Generate summaries of support conversations' },
  { key: 'translation', label: 'Auto-Translation', description: 'Automatically translate messages between nl/en/fr based on user language' },
  { key: 'autoSummarizeOnClose', label: 'Auto-Summarize on Close', description: 'Generate summary when ticket is closed' },
  { key: 'queueLangAwareness', label: 'Queue Language Awareness', description: 'Show per-language staffing header + cross-lang banner; pre-warm translations for cross-lang tickets' },
];

const IMPROVEMENT_OPTIONS: { value: ImprovementMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'optional', label: 'Optional' },
  { value: 'forced', label: 'Forced' },
];

const FIELD_LABEL = 'block text-[12px] font-medium text-[var(--color-ink-soft)] mb-1.5';
const INPUT =
  'w-full h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';
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

export default function EditPartnerModal({ partner, onClose }: EditPartnerModalProps) {
  const t = useT();
  const utils = trpc.useUtils();
  const [form, setForm] = useState<{
    name: string;
    aiEnabled: boolean;
    aiFeatures: AiFeatures;
  }>({ name: '', aiEnabled: false, aiFeatures: {} });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showError = useCallback((message: string) => setToast({ message, type: 'error' }), []);

  // Hydrate the form when the modal opens onto a partner (prop→state sync).
  useEffect(() => {
    if (partner) {
      const raw = (partner.aiFeatures ?? {}) as AiFeatures;
      let improvement: ImprovementMode = 'off';
      if ((raw as Record<string, unknown>).messageImprovement === true || raw.messageImprovement === 'optional') improvement = 'optional';
      else if (raw.messageImprovement === 'forced') improvement = 'forced';
      else if (typeof raw.messageImprovement === 'string') improvement = raw.messageImprovement as ImprovementMode;

      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({
        name: partner.name,
        aiEnabled: partner.aiEnabled ?? false,
        aiFeatures: { ...raw, messageImprovement: improvement },
      });
    }
  }, [partner]);

  const updatePartner = trpc.platform.updatePartner.useMutation({
    onSuccess: () => {
      utils.platform.listPartners.invalidate();
      onClose();
    },
    onError: (err) => showError(err.message),
  });

  function toggleFeature(key: Exclude<keyof AiFeatures, 'messageImprovement'>) {
    setForm(prev => ({
      ...prev,
      aiFeatures: { ...prev.aiFeatures, [key]: !prev.aiFeatures[key] },
    }));
  }

  if (!partner) return null;

  return (
    <>
      <Modal open={!!partner} onClose={onClose} id="edit-partner" maxWidth={640}>
        <ModalHeader onClose={onClose} title={form.name || partner.name} subtitle={partner.industry || undefined} />
        <ModalBody className="max-h-[70vh] overflow-y-auto">
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
                </div>
              ) : (
                <p className="text-[12px] text-[var(--color-ink-muted)] italic">AI is disabled for this tenant. Enable the toggle above to configure individual features.</p>
              )}
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" size="md" onClick={onClose}>{t('cancel')}</Button>
          <Button
            variant="primary"
            size="md"
            disabled={updatePartner.isPending}
            onClick={() => updatePartner.mutate({
              id: partner.id,
              data: {
                name: form.name,
                aiEnabled: form.aiEnabled,
                aiFeatures: form.aiFeatures,
              },
            })}
          >
            {t('save_profile')}
          </Button>
        </ModalFooter>
      </Modal>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { uploadLogo } from '../../utils/uploadLogo';
import Toast from '../Toast';
import type { Partner, AiFeatures, ImprovementMode } from './types';

interface EditPartnerModalProps {
  partner: Partner | null;
  onClose: () => void;
}

const BOOLEAN_FEATURES: { key: Exclude<keyof AiFeatures, 'messageImprovement'>; label: string; description: string }[] = [
  { key: 'chatSummarization', label: 'Chat Summarization', description: 'Generate summaries of support conversations' },
  { key: 'translation', label: 'Auto-Translation', description: 'Automatically translate messages between nl/en/fr based on user language' },
  { key: 'sentimentDetection', label: 'Sentiment Detection', description: 'Analyze message sentiment to flag issues' },
  { key: 'autoSummarizeOnClose', label: 'Auto-Summarize on Close', description: 'Generate summary when ticket is closed' },
];

const IMPROVEMENT_OPTIONS: { value: ImprovementMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'optional', label: 'Optional (button)' },
  { value: 'forced', label: 'Forced (auto)' },
];

export default function EditPartnerModal({ partner, onClose }: EditPartnerModalProps) {
  const t = useT();
  const utils = trpc.useUtils();
  const [form, setForm] = useState<{
    name: string;
    logoUrl: string | null;
    authMethod: 'local' | 'sso' | 'both';
    aiEnabled: boolean;
    aiFeatures: AiFeatures;
  }>({ name: '', logoUrl: null, authMethod: 'local', aiEnabled: false, aiFeatures: {} });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showError = useCallback((message: string) => setToast({ message, type: 'error' }), []);

  useEffect(() => {
    if (partner) {
      const raw = (partner.aiFeatures ?? {}) as AiFeatures;
      // Backward-compat: convert old boolean to 'optional'
      let improvement: ImprovementMode = 'off';
      if ((raw as Record<string, unknown>).messageImprovement === true || raw.messageImprovement === 'optional') improvement = 'optional';
      else if (raw.messageImprovement === 'forced') improvement = 'forced';
      else if (typeof raw.messageImprovement === 'string') improvement = raw.messageImprovement as ImprovementMode;

      setForm({
        name: partner.name,
        logoUrl: partner.logoUrl,
        authMethod: partner.authMethod,
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

  async function handleLogo(file: File) {
    try {
      const url = await uploadLogo(file);
      setForm(prev => ({ ...prev, logoUrl: url }));
    } catch (err) {
      showError(err instanceof Error ? err.message : t('request_failed'));
    }
  }

  function toggleFeature(key: Exclude<keyof AiFeatures, 'messageImprovement'>) {
    setForm(prev => ({
      ...prev,
      aiFeatures: { ...prev.aiFeatures, [key]: !prev.aiFeatures[key] },
    }));
  }

  if (!partner) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div onClick={onClose} aria-label="Close" className="absolute inset-0 bg-black/80" />
      <div role="dialog" aria-modal="true" className="w-full max-w-2xl bg-[var(--color-bg-surface)] border border-[var(--color-border)] relative z-10 p-8 max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold uppercase tracking-wide font-mono mb-6 border-b border-[var(--color-border)] pb-2">{form.name || partner.name}</h2>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mono-label">{t('display_name')}</label>
              <input type="text" className="input-field w-full"
                value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="mono-label">{t('id_label')}</label>
              <div className="input-field w-full font-mono opacity-50 cursor-default">{partner.id}</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="mono-label">Logo</label>
              <div className="flex items-center gap-3">
                {form.logoUrl ? (
                  <img src={form.logoUrl} alt="Partner logo preview" className="w-10 h-10 object-contain border border-[var(--color-border)]" />
                ) : (
                  <div className="w-10 h-10 border border-dashed border-[var(--color-border)]" />
                )}
                <input type="file" accept="image/*" className="hidden" id="logo-upload-edit"
                  onChange={e => e.target.files?.[0] && handleLogo(e.target.files[0])}
                />
                <label htmlFor="logo-upload-edit" className="btn-secondary cursor-pointer px-3 py-2 text-[10px] uppercase">
                  {form.logoUrl ? t('configure') : 'Upload'}
                </label>
              </div>
            </div>
            <div className="flex-1">
              <label className="mono-label">{t('provider_label')}</label>
              <select className="input-field w-full"
                value={form.authMethod} onChange={e => setForm({ ...form, authMethod: e.target.value as 'local' | 'sso' | 'both' })}>
                <option value="local">Local (Email/Password)</option>
                <option value="sso">Enterprise SSO</option>
                <option value="both">Both (Local + SSO)</option>
              </select>
            </div>
          </div>

          {/* ── AI Features ─────────────────────────────────────────────── */}
          <div className="border-t border-[var(--color-border)] pt-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="section-header">AI Features</h3>
              <button
                type="button"
                onClick={() => setForm(prev => ({ ...prev, aiEnabled: !prev.aiEnabled }))}
                className={`relative w-12 h-6 border border-[var(--color-border)] ${
                  form.aiEnabled ? 'bg-[var(--color-text-primary)]' : 'bg-transparent'
                }`}
                aria-label="Toggle AI"
              >
                <span className={`absolute top-0.5 w-4 h-4 ${
                  form.aiEnabled
                    ? 'right-0.5 bg-[var(--color-bg-base)]'
                    : 'left-0.5 bg-[var(--color-text-primary)]'
                }`} />
              </button>
            </div>

            {form.aiEnabled ? (
              <div className="space-y-3">
                {/* Message Improvement — 3-way selector */}
                <div className="flex items-center justify-between py-2 border-b border-[var(--color-border)]">
                  <div>
                    <div className="text-xs font-bold text-[var(--color-text-primary)]">Message Improvement</div>
                    <div className="text-[10px] text-[var(--color-text-muted)]">AI-powered rewriting of messages for clarity</div>
                  </div>
                  <div className="flex border border-[var(--color-border)]">
                    {IMPROVEMENT_OPTIONS.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setForm(prev => ({
                          ...prev,
                          aiFeatures: { ...prev.aiFeatures, messageImprovement: value },
                        }))}
                        className={`px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider font-mono ${
                          form.aiFeatures.messageImprovement === value
                            ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)]'
                            : 'hover:bg-[var(--color-bg-elevated)]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Boolean toggles */}
                {BOOLEAN_FEATURES.map(({ key, label, description }) => (
                  <div key={key} className="flex items-center justify-between py-2 border-b border-[var(--color-border)]">
                    <div>
                      <div className="text-xs font-bold text-[var(--color-text-primary)]">{label}</div>
                      <div className="text-[10px] text-[var(--color-text-muted)]">{description}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleFeature(key)}
                      className={`relative w-10 h-5 border border-[var(--color-border)] ${
                        form.aiFeatures[key] ? 'bg-[var(--color-text-primary)]' : 'bg-transparent'
                      }`}
                      aria-label={`Toggle ${label}`}
                    >
                      <span className={`absolute top-0 w-3 h-3 ${
                        form.aiFeatures[key]
                          ? 'right-0.5 bg-[var(--color-bg-base)]'
                          : 'left-0.5 bg-[var(--color-text-primary)]'
                      }`} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[var(--color-text-muted)] italic">AI is disabled for this tenant. Enable the toggle above to configure individual features.</p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
            <button onClick={onClose} className="btn-secondary px-6 py-2 text-[10px] uppercase tracking-widest">{t('cancel')}</button>
            <button onClick={() => updatePartner.mutate({
              id: partner.id,
              data: {
                name: form.name,
                logoUrl: form.logoUrl || undefined,
                authMethod: form.authMethod,
                aiEnabled: form.aiEnabled,
                aiFeatures: form.aiFeatures,
              },
            })}
              disabled={updatePartner.isPending}
              className="btn-primary px-6 py-2 text-[10px] uppercase tracking-widest disabled:opacity-20"
            >{t('save_profile')}</button>
          </div>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Info, ShieldCheck } from 'lucide-react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import Toast from '../Toast';
import Button from '../ui/Button';
import AiDisclosureModal from '../AiDisclosureModal';
import { usePanelMutations } from '../../hooks/usePanelMutations';

const CARD = 'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)] p-5';
const FIELD_LABEL = 'block text-[12px] font-medium text-[var(--color-ink)] mb-1';
const INPUT = 'w-full px-3 py-2 text-[13px] border border-[var(--color-border)] rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40';
const INPUT_DISABLED = 'opacity-60 cursor-not-allowed';
const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]';
const SECTION_HELP = 'text-[12px] text-[var(--color-ink-muted)] mt-1';
const FIELD_HELP = 'text-[11px] text-[var(--color-ink-muted)] mt-1 leading-snug';
const COUNTER = 'text-[11px] text-[var(--color-ink-muted)] mt-1 text-right tabular-nums';

const MAX_INSTRUCTION = 2000;

function parseTermList(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

export default function AdminAi() {
  const t = useT();
  const utils = trpc.useUtils();
  const query = trpc.partner.getAiCustomization.useQuery();
  const aiConfigQuery = trpc.partner.getAiConfig.useQuery(undefined, { staleTime: 60_000 });
  const { toast, setToast, defaults } = usePanelMutations();

  // AI is "effectively off" when the global kill-switch is flipped, OR when
  // every feature in the partner's aiFeatures resolves to off (the server
  // already returns DEFAULT_CONFIG when partner.aiEnabled = false). Customizing
  // glossary + custom instructions has no effect in that state, so the form
  // stays read-only — but values are preserved so re-enabling AI restores them.
  const aiCfg = aiConfigQuery.data;
  const aiEffectivelyOff = !aiCfg
    ? false
    : !aiCfg.globalAiEnabled
      || (aiCfg.messageImprovement === 'off'
        && !aiCfg.translation
        && !aiCfg.voiceTranscription
        && !aiCfg.cannedTranslation);

  const updateMutation = trpc.partner.updateAiCustomization.useMutation(
    defaults({
      invalidate: () => utils.partner.getAiCustomization.invalidate(),
      successMessage: t('admin_ai_saved_toast'),
    }),
  );

  const [preserve, setPreserve] = useState('');
  const [forbidden, setForbidden] = useState('');
  const [improve, setImprove] = useState('');
  const [translate, setTranslate] = useState('');
  const [disclosureOpen, setDisclosureOpen] = useState(false);

  // K-anonymous opt-out aggregate. Server hides the count when the partner
  // has fewer than the threshold of active workers, so admins cannot
  // identify single dissenters by elimination (CCT 81 §6).
  const anonymizedCountQuery = trpc.ai.getAnonymizedCount.useQuery(undefined, {
    staleTime: 60_000,
  });
  const anonStats = anonymizedCountQuery.data;

  useEffect(() => {
    const data = query.data;
    if (!data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreserve((data.aiTerms.preserve ?? []).join(', '));
    setForbidden((data.aiTerms.forbidden ?? []).join(', '));
    setImprove(data.aiCustomInstructions.improve ?? '');
    setTranslate(data.aiCustomInstructions.translate ?? '');
  }, [query.data]);

  if (query.isLoading || !query.data) {
    return <div className="text-[13px] text-[var(--color-ink-muted)] p-4">{t('loading')}</div>;
  }

  function handleSave() {
    updateMutation.mutate({
      aiTerms: {
        preserve: parseTermList(preserve),
        forbidden: parseTermList(forbidden),
      },
      aiCustomInstructions: {
        improve,
        translate,
      },
    });
  }

  const instructionFields = [
    { id: 'ai-improve', label: t('admin_ai_instructions_improve_label'), help: t('admin_ai_instructions_improve_help'), value: improve, set: setImprove },
    { id: 'ai-translate', label: t('admin_ai_instructions_translate_label'), help: t('admin_ai_instructions_translate_help'), value: translate, set: setTranslate },
  ];

  const inputCls = aiEffectivelyOff ? `${INPUT} ${INPUT_DISABLED}` : INPUT;

  return (
    <div className="space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <h2 className="text-[22px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">{t('admin_ai_title')}</h2>
          {aiEffectivelyOff && (
            <span
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-pill)] text-[11px] font-semibold uppercase tracking-[0.06em] bg-[color-mix(in_srgb,var(--color-accent-amber)_18%,transparent)] text-[var(--color-accent-amber)]"
              role="status"
              aria-live="polite"
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-accent-amber)]" aria-hidden />
              {t('admin_ai_disabled_pill')}
            </span>
          )}
        </div>
        <p className="text-[13px] text-[var(--color-ink-muted)] mt-1">{t('admin_ai_desc')}</p>
      </div>

      {aiEffectivelyOff && (
        <div
          role="note"
          className="flex items-start gap-2 rounded-[var(--radius-card)] border border-[var(--color-accent-amber)] bg-[color-mix(in_srgb,var(--color-accent-amber)_10%,transparent)] p-3"
        >
          <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-[var(--color-accent-amber)]" aria-hidden />
          <p className="text-[12px] text-[var(--color-ink-soft)] leading-relaxed">
            {t('admin_ai_disabled_banner')}
          </p>
        </div>
      )}

      <section className={CARD}>
        <h3 className={SECTION_LABEL}>{t('admin_ai_glossary_title')}</h3>
        <p className={SECTION_HELP}>{t('admin_ai_glossary_help')}</p>
        <div className="mt-4 space-y-4">
          <div>
            <label className={FIELD_LABEL} htmlFor="ai-preserve">{t('admin_ai_glossary_preserve_label')}</label>
            <textarea
              id="ai-preserve"
              className={`${inputCls} min-h-[64px] max-h-[40vh] [field-sizing:content] resize-y`}
              value={preserve}
              onChange={e => setPreserve(e.target.value)}
              placeholder="FTTP, MVNO, VoIP"
              disabled={aiEffectivelyOff}
              aria-disabled={aiEffectivelyOff || undefined}
            />
            <p className={FIELD_HELP}>{t('admin_ai_glossary_preserve_help')}</p>
          </div>
          <div>
            <label className={FIELD_LABEL} htmlFor="ai-forbidden">{t('admin_ai_glossary_forbidden_label')}</label>
            <textarea
              id="ai-forbidden"
              className={`${inputCls} min-h-[64px] max-h-[40vh] [field-sizing:content] resize-y`}
              value={forbidden}
              onChange={e => setForbidden(e.target.value)}
              placeholder="competitor name"
              disabled={aiEffectivelyOff}
              aria-disabled={aiEffectivelyOff || undefined}
            />
            <p className={FIELD_HELP}>{t('admin_ai_glossary_forbidden_help')}</p>
          </div>
        </div>
      </section>

      <section className={CARD}>
        <h3 className={SECTION_LABEL}>{t('admin_ai_instructions_title')}</h3>
        <p className={SECTION_HELP}>{t('admin_ai_instructions_help')}</p>
        <div className="mt-4 space-y-5">
          {instructionFields.map(({ id, label, help, value, set }) => (
            <div key={id}>
              <label className={FIELD_LABEL} htmlFor={id}>{label}</label>
              <p className={`${FIELD_HELP} mt-0 mb-1.5`}>{help}</p>
              <textarea
                id={id}
                className={`${inputCls} min-h-[140px] max-h-[70vh] text-[12px] [field-sizing:content] resize-y`}
                value={value}
                maxLength={MAX_INSTRUCTION}
                onChange={e => set(e.target.value)}
                disabled={aiEffectivelyOff}
                aria-disabled={aiEffectivelyOff || undefined}
              />
              <div className={COUNTER}>{value.length} / {MAX_INSTRUCTION}</div>
            </div>
          ))}
        </div>
      </section>

      <section className={CARD}>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[var(--color-accent)]" aria-hidden />
          <h3 className={SECTION_LABEL}>{t('admin_ai_compliance_title')}</h3>
        </div>
        <p className={SECTION_HELP}>{t('admin_ai_compliance_help')}</p>
        <div className="mt-4 space-y-3 text-[13px] text-[var(--color-ink-soft)]">
          {anonStats ? (
            <p>
              <span className="font-medium text-[var(--color-ink)]">{t('admin_ai_compliance_anon_label')}: </span>
              {anonStats.hidden
                ? t('admin_ai_compliance_group_too_small')
                : `${anonStats.anonymized} / ${anonStats.total}`}
            </p>
          ) : (
            <p className="text-[var(--color-ink-muted)]">{t('loading')}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDisclosureOpen(true)}>
              {t('admin_ai_compliance_view_disclosure')}
            </Button>
          </div>
          <p className={FIELD_HELP}>{t('admin_ai_compliance_footnote')}</p>
        </div>
      </section>

      <AiDisclosureModal open={disclosureOpen} onClose={() => setDisclosureOpen(false)} />

      <div className="pt-2">
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={updateMutation.isPending || aiEffectivelyOff}
          title={aiEffectivelyOff ? t('admin_ai_disabled_banner') : undefined}
        >
          {t('admin_ai_save')}
        </Button>
      </div>
    </div>
  );
}

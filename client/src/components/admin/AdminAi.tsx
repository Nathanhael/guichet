import { useEffect, useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import Toast from '../Toast';
import Button from '../ui/Button';

const FIELD_LABEL = 'block text-[12px] font-medium text-[var(--color-ink)] mb-1';
const INPUT = 'w-full px-3 py-2 text-[13px] border border-[var(--color-border)] rounded-[var(--radius-btn)] bg-[var(--color-bg-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40';
const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]';
const HELP = 'text-[12px] text-[var(--color-ink-muted)] mt-1';

const MAX_INSTRUCTION = 2000;

function parseTermList(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

export default function AdminAi() {
  const t = useT();
  const utils = trpc.useUtils();
  const query = trpc.partner.getAiCustomization.useQuery();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const updateMutation = trpc.partner.updateAiCustomization.useMutation({
    onSuccess: () => {
      utils.partner.getAiCustomization.invalidate();
      setToast({ message: t('admin_ai_saved_toast') || 'Saved', type: 'success' });
    },
    onError: (err) => setToast({ message: err.message, type: 'error' }),
  });

  const [preserve, setPreserve] = useState('');
  const [forbidden, setForbidden] = useState('');
  const [improve, setImprove] = useState('');
  const [translate, setTranslate] = useState('');
  const [summarize, setSummarize] = useState('');

  // Hydrate fields when the query lands.
  useEffect(() => {
    const data = query.data;
    if (!data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreserve((data.aiTerms.preserve ?? []).join(', '));
    setForbidden((data.aiTerms.forbidden ?? []).join(', '));
    setImprove(data.aiCustomInstructions.improve ?? '');
    setTranslate(data.aiCustomInstructions.translate ?? '');
    setSummarize(data.aiCustomInstructions.summarize ?? '');
  }, [query.data]);

  if (query.isLoading || !query.data) {
    return <div className="text-[13px] text-[var(--color-ink-muted)] p-4">{t('loading') || 'Loading…'}</div>;
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
        summarize,
      },
    });
  }

  return (
    <div className="max-w-3xl space-y-8">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <section>
        <h2 className={SECTION_LABEL}>{t('admin_ai_glossary_title') || 'AI Glossary'}</h2>
        <p className={HELP}>
          {t('admin_ai_glossary_help') || 'Words the AI should preserve verbatim or avoid. Comma-separated.'}
        </p>
        <div className="mt-3 space-y-4">
          <div>
            <label className={FIELD_LABEL} htmlFor="ai-preserve">
              {t('admin_ai_glossary_preserve_label') || 'Preserve (acronyms, brand names)'}
            </label>
            <input
              id="ai-preserve"
              type="text"
              className={INPUT}
              value={preserve}
              onChange={e => setPreserve(e.target.value)}
              placeholder="FTTP, MVNO, VoIP"
            />
          </div>
          <div>
            <label className={FIELD_LABEL} htmlFor="ai-forbidden">
              {t('admin_ai_glossary_forbidden_label') || 'Forbidden (terms AI must never use)'}
            </label>
            <input
              id="ai-forbidden"
              type="text"
              className={INPUT}
              value={forbidden}
              onChange={e => setForbidden(e.target.value)}
              placeholder="competitor name"
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className={SECTION_LABEL}>{t('admin_ai_instructions_title') || 'Custom Instructions per Action'}</h2>
        <p className={HELP}>
          {t('admin_ai_instructions_help') || 'Free-form guidance the AI prepends to its prompt for the matching action.'}
        </p>
        <div className="mt-3 space-y-4">
          {[
            { id: 'ai-improve', label: t('admin_ai_instructions_improve_label') || 'Improve', value: improve, set: setImprove },
            { id: 'ai-translate', label: t('admin_ai_instructions_translate_label') || 'Translate', value: translate, set: setTranslate },
            { id: 'ai-summarize', label: t('admin_ai_instructions_summarize_label') || 'Summarize', value: summarize, set: setSummarize },
          ].map(({ id, label, value, set }) => (
            <div key={id}>
              <label className={FIELD_LABEL} htmlFor={id}>{label}</label>
              <textarea
                id={id}
                className={`${INPUT} min-h-[80px] text-[12px]`}
                value={value}
                maxLength={MAX_INSTRUCTION}
                onChange={e => set(e.target.value)}
              />
              <div className={HELP}>{value.length} / {MAX_INSTRUCTION}</div>
            </div>
          ))}
        </div>
      </section>

      <div>
        <Button variant="primary" onClick={handleSave} disabled={updateMutation.isPending}>
          {t('admin_ai_save') || 'Save'}
        </Button>
      </div>
    </div>
  );
}

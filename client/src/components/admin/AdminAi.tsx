import { useEffect, useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import Toast from '../Toast';
import Button from '../ui/Button';

const CARD = 'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)] p-5';
const FIELD_LABEL = 'block text-[12px] font-medium text-[var(--color-ink)] mb-1';
const INPUT = 'w-full px-3 py-2 text-[13px] border border-[var(--color-border)] rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40';
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
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const updateMutation = trpc.partner.updateAiCustomization.useMutation({
    onSuccess: () => {
      utils.partner.getAiCustomization.invalidate();
      setToast({ message: t('admin_ai_saved_toast'), type: 'success' });
    },
    onError: (err) => setToast({ message: err.message, type: 'error' }),
  });

  const [preserve, setPreserve] = useState('');
  const [forbidden, setForbidden] = useState('');
  const [improve, setImprove] = useState('');
  const [translate, setTranslate] = useState('');

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

  return (
    <div className="max-w-3xl space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div>
        <h2 className="text-[22px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">{t('admin_ai_title')}</h2>
        <p className="text-[13px] text-[var(--color-ink-muted)] mt-1">{t('admin_ai_desc')}</p>
      </div>

      <section className={CARD}>
        <h3 className={SECTION_LABEL}>{t('admin_ai_glossary_title')}</h3>
        <p className={SECTION_HELP}>{t('admin_ai_glossary_help')}</p>
        <div className="mt-4 space-y-4">
          <div>
            <label className={FIELD_LABEL} htmlFor="ai-preserve">{t('admin_ai_glossary_preserve_label')}</label>
            <input
              id="ai-preserve"
              type="text"
              className={INPUT}
              value={preserve}
              onChange={e => setPreserve(e.target.value)}
              placeholder="FTTP, MVNO, VoIP"
            />
            <p className={FIELD_HELP}>{t('admin_ai_glossary_preserve_help')}</p>
          </div>
          <div>
            <label className={FIELD_LABEL} htmlFor="ai-forbidden">{t('admin_ai_glossary_forbidden_label')}</label>
            <input
              id="ai-forbidden"
              type="text"
              className={INPUT}
              value={forbidden}
              onChange={e => setForbidden(e.target.value)}
              placeholder="competitor name"
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
                className={`${INPUT} min-h-[80px] text-[12px]`}
                value={value}
                maxLength={MAX_INSTRUCTION}
                onChange={e => set(e.target.value)}
              />
              <div className={COUNTER}>{value.length} / {MAX_INSTRUCTION}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="pt-2">
        <Button variant="primary" onClick={handleSave} disabled={updateMutation.isPending}>
          {t('admin_ai_save')}
        </Button>
      </div>
    </div>
  );
}

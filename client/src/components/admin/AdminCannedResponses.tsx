import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { Plus, Trash2, RefreshCw, Pencil, X, Check, MessageSquareText, AlertTriangle } from 'lucide-react';
import ErrorBox from './ErrorBox';
import FieldError from '../FieldError';
import BionicText from '../BionicText';
import { cannedResponseCreateSchema, validateForm, FieldErrors } from '../../validation/adminSchemas';
import { useStoreShallow } from '../../store/useStore';
import { usePartner } from '../../hooks/usePartner';

type SupportedLang = 'nl' | 'fr' | 'en';
const ALL_LANGS: SupportedLang[] = ['nl', 'fr', 'en'];

interface CannedResponse {
  id: string;
  dept: string | null;
  title: string;
  body: string;
  shortcut: string | null;
  sourceLang: string;
  bodyTranslations: Record<string, string>;
  staleTranslations: Record<string, boolean>;
  createdAt: string;
}

const CARD = 'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)]';
const INPUT = 'w-full h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';
const TEXTAREA = 'w-full px-3 py-2 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)] resize-y';
const ICON_BTN = 'w-8 h-8 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors disabled:opacity-50';
const LABEL = 'text-[12px] font-medium text-[var(--color-ink-soft)] mb-1.5 block';
const COL_HEAD = 'px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]';
const PRIMARY_BTN = 'h-9 px-4 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-accent)] hover:brightness-110 text-white text-[13px] font-medium shadow-[var(--shadow-soft)] disabled:opacity-50 transition-all';
const SECONDARY_BTN = 'h-9 px-4 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[var(--color-ink)] text-[13px] font-medium transition-colors';
const TAB_BTN = 'h-8 px-3 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] text-[12px] font-medium transition-colors';
const TAB_ACTIVE = 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]';
const TAB_INACTIVE = 'text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]';

function isSupportedLang(v: string | null | undefined): v is SupportedLang {
  return v === 'nl' || v === 'fr' || v === 'en';
}

function defaultSourceLang(userLang: string | null | undefined): SupportedLang {
  return isSupportedLang(userLang) ? userLang : 'en';
}

export default function AdminCannedResponses() {
  const t = useT();
  const { bionicReading, user } = useStoreShallow(s => ({ bionicReading: s.bionicReading, user: s.user }));
  const { manifest } = usePartner();
  const departments = manifest.departments || [];
  const utils = trpc.useUtils();

  const aiConfigQuery = trpc.partner.getAiConfig.useQuery(undefined, { staleTime: 60_000 });
  const featureOn = !!aiConfigQuery.data?.cannedTranslation;

  const initialSourceLang = defaultSourceLang(user?.lang ?? null);

  // Create form state
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newDept, setNewDept] = useState('');
  const [newShortcut, setNewShortcut] = useState('');
  const [newSourceLang, setNewSourceLang] = useState<SupportedLang>(initialSourceLang);

  // Edit form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editDept, setEditDept] = useState('');
  const [editShortcut, setEditShortcut] = useState('');
  const [editSourceLang, setEditSourceLang] = useState<SupportedLang>(initialSourceLang);
  const [editTranslations, setEditTranslations] = useState<Record<SupportedLang, string>>({ nl: '', fr: '', en: '' });
  const [editTranslationsTouched, setEditTranslationsTouched] = useState<Record<SupportedLang, boolean>>({ nl: false, fr: false, en: false });
  const [activeEditLang, setActiveEditLang] = useState<SupportedLang>(initialSourceLang);
  const [originalBody, setOriginalBody] = useState('');

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [regeneratingPair, setRegeneratingPair] = useState<{ id: string; lang: SupportedLang } | null>(null);

  const { data: responses, isLoading, error: fetchError, refetch } = trpc.cannedResponse.list.useQuery();

  const invalidate = () => utils.cannedResponse.list.invalidate();

  const createMutation = trpc.cannedResponse.create.useMutation({
    onSuccess: () => {
      setNewTitle('');
      setNewBody('');
      setNewDept('');
      setNewShortcut('');
      setNewSourceLang(initialSourceLang);
      invalidate();
    },
  });

  const updateMutation = trpc.cannedResponse.update.useMutation({
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
  });

  const deleteMutation = trpc.cannedResponse.delete.useMutation({
    onSuccess: () => invalidate(),
  });

  const regenerateMutation = trpc.cannedResponse.regenerate.useMutation({
    onSuccess: () => {
      setRegeneratingPair(null);
      invalidate();
    },
    onError: () => setRegeneratingPair(null),
  });

  const backfillMutation = trpc.cannedResponse.backfillUntranslated.useMutation({
    onSuccess: () => invalidate(),
  });

  const addResponse = () => {
    const errors = validateForm(cannedResponseCreateSchema, {
      title: newTitle, body: newBody, dept: newDept || undefined, shortcut: newShortcut || undefined,
    });
    if (errors) { setFieldErrors(errors); return; }
    setFieldErrors({});
    createMutation.mutate({
      title: newTitle.trim(),
      body: newBody.trim(),
      dept: newDept.trim() || undefined,
      shortcut: newShortcut.trim() || undefined,
      sourceLang: newSourceLang,
    });
  };

  const startEdit = (r: CannedResponse) => {
    setEditingId(r.id);
    setEditTitle(r.title);
    setEditBody(r.body);
    setOriginalBody(r.body);
    setEditDept(r.dept || '');
    setEditShortcut(r.shortcut || '');
    const src: SupportedLang = isSupportedLang(r.sourceLang) ? r.sourceLang : 'en';
    setEditSourceLang(src);
    setActiveEditLang(src);
    const trans = r.bodyTranslations || {};
    setEditTranslations({
      nl: trans.nl ?? '',
      fr: trans.fr ?? '',
      en: trans.en ?? '',
    });
    setEditTranslationsTouched({ nl: false, fr: false, en: false });
  };

  const saveEdit = () => {
    if (!editingId || !editTitle.trim() || !editBody.trim()) return;

    // Only send bodyTranslations if the admin touched any non-source tab.
    // This avoids accidentally rewriting the column on title-only edits.
    let bodyTranslations: Partial<Record<SupportedLang, string>> | undefined;
    if (featureOn) {
      const touched: Partial<Record<SupportedLang, string>> = {};
      let any = false;
      for (const lang of ALL_LANGS) {
        if (lang === editSourceLang) continue;
        if (editTranslationsTouched[lang]) {
          touched[lang] = editTranslations[lang];
          any = true;
        }
      }
      if (any) bodyTranslations = touched;
    }

    updateMutation.mutate({
      id: editingId,
      title: editTitle.trim(),
      body: editBody.trim(),
      dept: editDept.trim() || null,
      shortcut: editShortcut.trim() || null,
      sourceLang: editSourceLang,
      bodyTranslations,
    });
  };

  const cancelEdit = () => setEditingId(null);

  const deleteResponse = (id: string) => {
    deleteMutation.mutate({ id });
  };

  const regenerate = (id: string, lang: SupportedLang) => {
    setRegeneratingPair({ id, lang });
    regenerateMutation.mutate({ id, langs: [lang] });
  };

  const setEditTranslation = (lang: SupportedLang, value: string) => {
    setEditTranslations((prev) => ({ ...prev, [lang]: value }));
    setEditTranslationsTouched((prev) => ({ ...prev, [lang]: true }));
  };

  const error = fetchError?.message
    || createMutation.error?.message
    || updateMutation.error?.message
    || deleteMutation.error?.message
    || regenerateMutation.error?.message
    || backfillMutation.error?.message;

  const bodyChangedFromOriginal = featureOn && editBody.trim() !== originalBody.trim();

  const untranslatedCount = featureOn && responses
    ? responses.filter((r) => {
        const cr = r as CannedResponse;
        return Object.keys(cr.bodyTranslations || {}).length === 0;
      }).length
    : 0;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">{t('canned_responses')}</h2>
          <p className="text-[13px] text-[var(--color-ink-muted)] mt-1">{t('canned_responses_desc')}</p>
        </div>
        <button
          onClick={() => refetch()}
          className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors"
          title={t('refresh')}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <ErrorBox error={error} />

      {/* Create new canned response */}
      <div className={`${CARD} p-5 mb-6`}>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] mb-4">{t('create_new_response')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className={LABEL}>{t('canned_title_required_label')}</label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => { setNewTitle(e.target.value); setFieldErrors({}); }}
              placeholder={t('canned_title_placeholder')}
              className={`${INPUT} ${fieldErrors.title ? 'border-[var(--color-urgent)]' : ''}`}
            />
            <FieldError error={fieldErrors.title} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>{t('department')}</label>
              <select
                value={newDept}
                onChange={(e) => setNewDept(e.target.value)}
                className={INPUT}
              >
                <option value="">{t('global')}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>{t('shortcut')}</label>
              <input
                type="text"
                value={newShortcut}
                onChange={(e) => setNewShortcut(e.target.value)}
                placeholder={t('canned_shortcut_placeholder')}
                className={INPUT}
              />
            </div>
          </div>
        </div>
        {featureOn && (
          <div className="mb-4">
            <label className={LABEL}>{t('admin_canned_translate_source_lang')}</label>
            <select
              value={newSourceLang}
              onChange={(e) => setNewSourceLang(e.target.value as SupportedLang)}
              className={INPUT}
              data-testid="new-source-lang"
            >
              {ALL_LANGS.map((l) => (
                <option key={l} value={l}>{l.toUpperCase()}</option>
              ))}
            </select>
          </div>
        )}
        <div className="mb-4">
          <label className={LABEL}>{t('canned_body_required_label')}</label>
          <textarea
            value={newBody}
            onChange={(e) => { setNewBody(e.target.value); setFieldErrors({}); }}
            placeholder={t('canned_body_placeholder')}
            rows={3}
            className={`${TEXTAREA} ${fieldErrors.body ? 'border-[var(--color-urgent)]' : ''}`}
          />
          <FieldError error={fieldErrors.body} />
          <p className="text-[11px] text-[var(--color-ink-muted)] mt-1.5">
            {t('variables_hint')}
          </p>
        </div>
        <div className="flex justify-end">
          <button
            onClick={addResponse}
            disabled={!newTitle.trim() || !newBody.trim() || createMutation.isPending}
            className={PRIMARY_BTN}
          >
            <Plus className="h-3.5 w-3.5" />
            {createMutation.isPending ? t('creating') : t('create')}
          </button>
        </div>
      </div>

      {/* Untranslated backfill banner */}
      {featureOn && untranslatedCount > 0 && (
        <div
          className={`${CARD} flex items-center justify-between gap-3 p-4 mb-4 border border-[var(--color-accent)]/20`}
          data-testid="canned-backfill-banner"
        >
          <div className="flex items-center gap-2 text-[13px] text-[var(--color-ink)]">
            <AlertTriangle className="h-4 w-4 text-[var(--color-accent)]" />
            <span>
              {t('admin_canned_translate_backfill_banner').replace('{count}', String(untranslatedCount))}
            </span>
          </div>
          <button
            onClick={() => backfillMutation.mutate()}
            disabled={backfillMutation.isPending}
            className={PRIMARY_BTN}
            data-testid="canned-backfill-button"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${backfillMutation.isPending ? 'animate-spin' : ''}`} />
            {backfillMutation.isPending
              ? t('admin_canned_translate_translating')
              : t('admin_canned_translate_backfill_button')}
          </button>
        </div>
      )}

      {/* Responses list */}
      <div className={`${CARD} overflow-hidden`}>
        <div className="grid grid-cols-[1fr_120px_120px_80px] border-b border-[var(--color-border)]">
          <div className={COL_HEAD}>{t('col_title')}</div>
          <div className={COL_HEAD}>{t('col_dept')}</div>
          <div className={COL_HEAD}>{t('shortcut')}</div>
          <div className={COL_HEAD}></div>
        </div>

        {isLoading ? (
          <div className="px-4 py-8 text-center text-[13px] text-[var(--color-ink-muted)]">
            {t('loading')}
          </div>
        ) : !responses || responses.length === 0 ? (
          <div className="px-4 py-12 text-center text-[13px] text-[var(--color-ink-muted)]">
            {t('no_canned_responses')}
          </div>
        ) : (
          responses.map((r) => {
            const cr = r as CannedResponse;
            return (
              <div key={cr.id}>
                {editingId === cr.id ? (
                  <div className="border-b border-[var(--color-border)] last:border-b-0 p-4 bg-[var(--color-bg-elevated)]">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                      <div>
                        <label className={LABEL}>{t('col_title')}</label>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className={INPUT}
                        />
                      </div>
                      <div>
                        <label className={LABEL}>{t('col_dept')}</label>
                        <select
                          value={editDept}
                          onChange={(e) => setEditDept(e.target.value)}
                          className={INPUT}
                        >
                          <option value="">{t('global')}</option>
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={LABEL}>{t('shortcut')}</label>
                        <input
                          type="text"
                          value={editShortcut}
                          onChange={(e) => setEditShortcut(e.target.value)}
                          placeholder={t('canned_shortcut_none_placeholder')}
                          className={INPUT}
                        />
                      </div>
                    </div>

                    {featureOn && (
                      <div className="mb-3">
                        <label className={LABEL}>{t('admin_canned_translate_source_lang')}</label>
                        <select
                          value={editSourceLang}
                          onChange={(e) => {
                            const next = e.target.value as SupportedLang;
                            setEditSourceLang(next);
                            if (activeEditLang === next || !ALL_LANGS.includes(activeEditLang)) {
                              setActiveEditLang(next);
                            }
                          }}
                          className={INPUT}
                          data-testid="edit-source-lang"
                        >
                          {ALL_LANGS.map((l) => (
                            <option key={l} value={l}>{l.toUpperCase()}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {featureOn ? (
                      <>
                        <div className="flex items-center gap-1 mb-2" role="tablist" aria-label={t('admin_canned_translate_label')}>
                          {ALL_LANGS.map((lang) => {
                            const isSource = lang === editSourceLang;
                            const isStale = !isSource && !!cr.staleTranslations?.[lang];
                            const isActive = activeEditLang === lang;
                            return (
                              <button
                                key={lang}
                                role="tab"
                                aria-selected={isActive}
                                onClick={() => setActiveEditLang(lang)}
                                className={`${TAB_BTN} ${isActive ? TAB_ACTIVE : TAB_INACTIVE}`}
                              >
                                {lang.toUpperCase()}
                                {isSource && <span className="text-[10px] opacity-70">(source)</span>}
                                {isStale && (
                                  <span
                                    className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-urgent)]"
                                    aria-label={t('admin_canned_translate_stale')}
                                  />
                                )}
                              </button>
                            );
                          })}
                        </div>
                        {ALL_LANGS.map((lang) => {
                          if (lang !== activeEditLang) return null;
                          const isSource = lang === editSourceLang;
                          const isStale = !isSource && !!cr.staleTranslations?.[lang];
                          const isRegenerating = regenerateMutation.isPending
                            && regeneratingPair?.id === cr.id
                            && regeneratingPair?.lang === lang;

                          if (isSource) {
                            return (
                              <div key={lang} className="mb-3">
                                <label className={LABEL}>{t('canned_body_label')}</label>
                                <textarea
                                  value={editBody}
                                  onChange={(e) => setEditBody(e.target.value)}
                                  rows={3}
                                  className={TEXTAREA}
                                  data-testid={`edit-body-${lang}`}
                                />
                                {bodyChangedFromOriginal && (
                                  <p className="text-[11px] text-[var(--color-ink-muted)] mt-1.5">
                                    {t('canned_save_marks_stale_hint')}
                                  </p>
                                )}
                              </div>
                            );
                          }
                          return (
                            <div key={lang} className="mb-3">
                              {isStale && (
                                <div className="flex items-center gap-1.5 mb-1.5 text-[12px] text-[var(--color-urgent)]">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  <span>{t('admin_canned_translate_stale')}</span>
                                </div>
                              )}
                              <textarea
                                value={editTranslations[lang]}
                                onChange={(e) => setEditTranslation(lang, e.target.value)}
                                placeholder={t('admin_canned_translate_no_translation')}
                                rows={3}
                                className={TEXTAREA}
                                data-testid={`edit-body-${lang}`}
                              />
                              <div className="flex justify-end mt-1.5">
                                <button
                                  type="button"
                                  onClick={() => regenerate(cr.id, lang)}
                                  disabled={regenerateMutation.isPending}
                                  className={SECONDARY_BTN}
                                  data-testid={`regenerate-${lang}`}
                                >
                                  <RefreshCw className={`h-3 w-3 ${isRegenerating ? 'animate-spin' : ''}`} />
                                  {isRegenerating ? t('admin_canned_translate_translating') : t('admin_canned_translate_regenerate')}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <div className="mb-3">
                        <label className={LABEL}>{t('canned_body_label')}</label>
                        <textarea
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          rows={3}
                          className={TEXTAREA}
                        />
                      </div>
                    )}

                    <div className="flex gap-2 justify-end">
                      <button onClick={cancelEdit} className={SECONDARY_BTN}>
                        <X className="h-3 w-3" /> {t('cancel')}
                      </button>
                      <button
                        onClick={saveEdit}
                        disabled={!editTitle.trim() || !editBody.trim() || updateMutation.isPending}
                        className={PRIMARY_BTN}
                      >
                        <Check className="h-3 w-3" /> {updateMutation.isPending ? t('saving_ellipsis') : t('save')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className="grid grid-cols-[1fr_120px_120px_80px] border-b border-[var(--color-border)] last:border-b-0 group hover:bg-[var(--color-hover)] transition-colors cursor-pointer"
                      onClick={() => setExpandedId(expandedId === cr.id ? null : cr.id)}
                    >
                      <div className="px-4 py-3 text-[14px] font-medium text-[var(--color-ink)] flex items-center gap-2">
                        <MessageSquareText className="h-3.5 w-3.5 text-[var(--color-ink-muted)] shrink-0" />
                        {cr.title}
                        {featureOn && Object.values(cr.staleTranslations || {}).some(Boolean) && (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] text-[var(--color-urgent)]"
                            title={t('admin_canned_translate_stale')}
                          >
                            <AlertTriangle className="h-3 w-3" />
                          </span>
                        )}
                      </div>
                      <div className="px-4 py-3 text-[12px] text-[var(--color-ink-soft)] flex items-center">
                        {cr.dept ? (departments.find(d => d.id === cr.dept)?.name || cr.dept) : <span className="italic text-[var(--color-ink-muted)]">{t('canned_global_inline')}</span>}
                      </div>
                      <div className="px-4 py-3 text-[12px] font-mono text-[var(--color-ink-soft)] flex items-center">
                        {cr.shortcut || <span className="italic font-sans text-[var(--color-ink-muted)]">—</span>}
                      </div>
                      <div className="px-4 py-3 flex items-center justify-end gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); startEdit(cr); }}
                          className={`${ICON_BTN} opacity-0 group-hover:opacity-100`}
                          title={t('edit')}
                          aria-label={t('canned_edit_for_aria').replace('{title}', cr.title)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteResponse(cr.id); }}
                          disabled={deleteMutation.isPending}
                          className={`${ICON_BTN} opacity-0 group-hover:opacity-100`}
                          title={t('delete')}
                          aria-label={t('canned_delete_for_aria').replace('{title}', cr.title)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    {expandedId === cr.id && (
                      <div className="px-4 py-3 border-b border-[var(--color-border)] last:border-b-0 bg-[var(--color-bg-elevated)]">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] mb-1.5">{t('body_preview')}</p>
                        <p className="text-[13px] text-[var(--color-ink)] whitespace-pre-wrap">{bionicReading ? <BionicText text={cr.body} /> : cr.body}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {responses && responses.length > 0 && (
        <div className="mt-3 text-[12px] text-[var(--color-ink-muted)] text-right">
          {t(responses.length === 1 ? 'canned_response_count_singular' : 'canned_response_count_plural').replace('{count}', String(responses.length))}
        </div>
      )}
    </div>
  );
}

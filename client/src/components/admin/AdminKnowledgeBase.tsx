import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { Plus, Trash2, RefreshCw, Pencil, X, Check, BookOpen, Eye, EyeOff, Search } from 'lucide-react';
import ErrorBox from './ErrorBox';
import FieldError from '../FieldError';
import BionicText from '../BionicText';
import { kbArticleCreateSchema, validateForm, FieldErrors } from '../../validation/adminSchemas';
import { useStoreShallow } from '../../store/useStore';

interface KBArticle {
  id: string;
  title: string;
  body: string;
  dept: string | null;
  tags?: unknown;
  slug: string | null;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

const CARD = 'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)]';
const INPUT = 'w-full h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';
const TEXTAREA = 'w-full px-3 py-2 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)] resize-y';
const ICON_BTN = 'w-8 h-8 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors disabled:opacity-50';
const LABEL = 'text-[12px] font-medium text-[var(--color-ink-soft)] mb-1.5 block';
const COL_HEAD = 'px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]';
const PRIMARY_BTN = 'h-9 px-4 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-accent)] hover:brightness-110 text-white text-[13px] font-medium shadow-[var(--shadow-soft)] disabled:opacity-50 transition-all';
const SECONDARY_BTN = 'h-9 px-4 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[var(--color-ink)] text-[13px] font-medium transition-colors';

export default function AdminKnowledgeBase() {
  const t = useT();
  const { bionicReading } = useStoreShallow(s => ({ bionicReading: s.bionicReading }));

  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newDept, setNewDept] = useState('');
  const [newTags, setNewTags] = useState('');
  const [newPublished, setNewPublished] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editDept, setEditDept] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editPublished, setEditPublished] = useState(true);

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const utils = trpc.useUtils();
  const { data: articles, isLoading, error: fetchError } = trpc.kb.list.useQuery(
    { includeUnpublished: true }
  );
  const invalidate = () => utils.kb.list.invalidate();

  const createMutation = trpc.kb.create.useMutation({
    onSuccess: () => {
      setNewTitle('');
      setNewBody('');
      setNewDept('');
      setNewTags('');
      setNewPublished(true);
      setShowCreateForm(false);
      invalidate();
    },
  });

  const updateMutation = trpc.kb.update.useMutation({
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
  });

  const deleteMutation = trpc.kb.delete.useMutation({
    onSuccess: invalidate,
  });

  const parseTags = (str: string): string[] =>
    str.split(',').map(s => s.trim()).filter(Boolean);

  const addArticle = () => {
    const errors = validateForm(kbArticleCreateSchema, { title: newTitle, body: newBody });
    if (errors) { setFieldErrors(errors); return; }
    setFieldErrors({});
    createMutation.mutate({
      title: newTitle.trim(),
      body: newBody.trim(),
      dept: newDept.trim() || undefined,
      tags: parseTags(newTags),
      published: newPublished,
    });
  };

  const startEdit = (a: KBArticle) => {
    setEditingId(a.id);
    setEditTitle(a.title);
    setEditBody(a.body);
    setEditDept(a.dept || '');
    setEditTags(((a.tags as string[]) || []).join(', '));
    setEditPublished(a.published);
  };

  const saveEdit = () => {
    if (!editingId || !editTitle.trim() || !editBody.trim()) return;
    updateMutation.mutate({
      id: editingId,
      title: editTitle.trim(),
      body: editBody.trim(),
      dept: editDept.trim() || null,
      tags: parseTags(editTags),
      published: editPublished,
    });
  };

  const togglePublished = (a: KBArticle) => {
    updateMutation.mutate({ id: a.id, published: !a.published });
  };

  const error = fetchError?.message || createMutation.error?.message || updateMutation.error?.message || deleteMutation.error?.message;

  const filtered = articles?.filter((a) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.title.toLowerCase().includes(q) ||
      a.body.toLowerCase().includes(q) ||
      ((a.tags as string[]) || []).some(t => t.toLowerCase().includes(q))
    );
  });

  return (
    <div className="max-w-5xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">{t('knowledge_base')}</h2>
          <p className="text-[13px] text-[var(--color-ink-muted)] mt-1">{t('knowledge_base_desc')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCreateForm(!showCreateForm)} className={PRIMARY_BTN}>
            <Plus className="h-3.5 w-3.5" />
            New Article
          </button>
          <button
            onClick={() => invalidate()}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors"
            title={t('refresh') || 'Refresh'}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <ErrorBox error={error} />

      {/* Search bar */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-ink-muted)]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search articles by title, content, or tags…"
          className={`${INPUT} pl-10`}
        />
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className={`${CARD} p-5 mb-6`}>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] mb-4">New Article</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="md:col-span-2">
              <label className={LABEL}>Title *</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => { setNewTitle(e.target.value); setFieldErrors({}); }}
                placeholder="e.g. How to reset a customer password"
                className={`${INPUT} ${fieldErrors.title ? 'border-[var(--color-urgent)]' : ''}`}
              />
              <FieldError error={fieldErrors.title} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>Dept</label>
                <input type="text" value={newDept} onChange={(e) => setNewDept(e.target.value)} placeholder="(all)" className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>Tags</label>
                <input type="text" value={newTags} onChange={(e) => setNewTags(e.target.value)} placeholder="billing, faq" className={INPUT} />
              </div>
            </div>
          </div>
          <div className="mb-4">
            <label className={LABEL}>Content *</label>
            <textarea
              value={newBody}
              onChange={(e) => { setNewBody(e.target.value); setFieldErrors({}); }}
              placeholder="Write the article content here… (Markdown supported)"
              rows={8}
              className={`${TEXTAREA} font-mono ${fieldErrors.body ? 'border-[var(--color-urgent)]' : ''}`}
            />
            <FieldError error={fieldErrors.body} />
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newPublished}
                onChange={(e) => setNewPublished(e.target.checked)}
                className="w-4 h-4 rounded-[var(--radius-btn)] accent-[var(--color-accent)]"
              />
              <span className="text-[13px] text-[var(--color-ink)]">Published</span>
            </label>
            <div className="flex gap-2">
              <button onClick={() => setShowCreateForm(false)} className={SECONDARY_BTN}>Cancel</button>
              <button
                onClick={addArticle}
                disabled={!newTitle.trim() || !newBody.trim() || createMutation.isPending}
                className={PRIMARY_BTN}
              >
                <Plus className="h-3.5 w-3.5" />
                {createMutation.isPending ? t('creating') : t('create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Articles list */}
      <div className={`${CARD} overflow-hidden`}>
        <div className="grid grid-cols-[1fr_100px_140px_100px_100px] border-b border-[var(--color-border)]">
          <div className={COL_HEAD}>Title</div>
          <div className={COL_HEAD}>Dept</div>
          <div className={COL_HEAD}>Tags</div>
          <div className={COL_HEAD}>Status</div>
          <div className={COL_HEAD}></div>
        </div>

        {isLoading ? (
          <div className="px-4 py-8 text-center text-[13px] text-[var(--color-ink-muted)]">{t('loading') || 'Loading…'}</div>
        ) : !filtered || filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-[13px] text-[var(--color-ink-muted)]">
            {searchQuery ? 'No matching articles' : 'No articles yet'}
          </div>
        ) : (
          filtered.map((a) => (
            <div key={a.id}>
              {editingId === a.id ? (
                <div className="border-b border-[var(--color-border)] last:border-b-0 p-4 bg-[var(--color-bg-elevated)]">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    <div className="md:col-span-2">
                      <label className={LABEL}>Title</label>
                      <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className={INPUT} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={LABEL}>Dept</label>
                        <input type="text" value={editDept} onChange={(e) => setEditDept(e.target.value)} placeholder="(all)" className={INPUT} />
                      </div>
                      <div>
                        <label className={LABEL}>Tags</label>
                        <input type="text" value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder="tag1, tag2" className={INPUT} />
                      </div>
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className={LABEL}>Content</label>
                    <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={8} className={`${TEXTAREA} font-mono`} />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editPublished}
                        onChange={(e) => setEditPublished(e.target.checked)}
                        className="w-4 h-4 rounded-[var(--radius-btn)] accent-[var(--color-accent)]"
                      />
                      <span className="text-[13px] text-[var(--color-ink)]">Published</span>
                    </label>
                    <div className="flex gap-2">
                      <button onClick={() => setEditingId(null)} className={SECONDARY_BTN}>
                        <X className="h-3 w-3" /> Cancel
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
                </div>
              ) : (
                <>
                  <div
                    className="grid grid-cols-[1fr_100px_140px_100px_100px] border-b border-[var(--color-border)] last:border-b-0 group hover:bg-[var(--color-hover)] transition-colors cursor-pointer"
                    onClick={() => setPreviewId(previewId === a.id ? null : a.id)}
                  >
                    <div className="px-4 py-3 text-[14px] font-medium text-[var(--color-ink)] flex items-center gap-2">
                      <BookOpen className="h-3.5 w-3.5 text-[var(--color-ink-muted)] shrink-0" />
                      {a.title}
                    </div>
                    <div className="px-4 py-3 text-[12px] text-[var(--color-ink-soft)] flex items-center">
                      {a.dept || <span className="italic text-[var(--color-ink-muted)]">all</span>}
                    </div>
                    <div className="px-4 py-3 flex items-center gap-1 flex-wrap">
                      {((a.tags as string[]) || []).slice(0, 3).map((t) => (
                        <span key={t} className="px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] text-[11px] text-[var(--color-ink-soft)]">{t}</span>
                      ))}
                    </div>
                    <div className="px-4 py-3 flex items-center">
                      {a.published ? (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">Published</span>
                      ) : (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] text-[var(--color-ink-muted)]">Draft</span>
                      )}
                    </div>
                    <div className="px-4 py-3 flex items-center justify-end gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePublished(a); }}
                        className={`${ICON_BTN} opacity-0 group-hover:opacity-100`}
                        title={a.published ? 'Unpublish' : 'Publish'}
                        aria-label={a.published ? `Unpublish ${a.title}` : `Publish ${a.title}`}
                      >
                        {a.published ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); startEdit(a); }}
                        className={`${ICON_BTN} opacity-0 group-hover:opacity-100`}
                        title="Edit"
                        aria-label={`Edit ${a.title}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteMutation.mutate({ id: a.id }); }}
                        disabled={deleteMutation.isPending}
                        className={`${ICON_BTN} opacity-0 group-hover:opacity-100`}
                        title="Delete"
                        aria-label={`Delete ${a.title}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {previewId === a.id && (
                    <div className="px-4 py-4 border-b border-[var(--color-border)] last:border-b-0 bg-[var(--color-bg-elevated)]">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] mb-2">Article Preview</p>
                      <div className="text-[13px] text-[var(--color-ink)] whitespace-pre-wrap max-h-96 overflow-y-auto leading-relaxed">
                        {bionicReading ? <BionicText text={a.body} /> : a.body}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>

      {filtered && filtered.length > 0 && (
        <div className="mt-3 text-[12px] text-[var(--color-ink-muted)] text-right">
          {filtered.length} article{filtered.length !== 1 ? 's' : ''}
          {articles && filtered.length !== articles.length && ` (of ${articles.length})`}
        </div>
      )}
    </div>
  );
}

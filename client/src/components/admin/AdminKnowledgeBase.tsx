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

export default function AdminKnowledgeBase() {
  const t = useT();
  const { bionicReading } = useStoreShallow(s => ({ bionicReading: s.bionicReading }));
  // Create form
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newDept, setNewDept] = useState('');
  const [newTags, setNewTags] = useState('');
  const [newPublished, setNewPublished] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editDept, setEditDept] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editPublished, setEditPublished] = useState(true);

  // Preview
  const [previewId, setPreviewId] = useState<string | null>(null);

  // Search
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

  // Filter articles by search
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
          <h2 className="text-lg font-bold uppercase tracking-wide">{t('knowledge_base')}</h2>
          <p className="text-xs uppercase text-[var(--color-text-secondary)] mt-1">{t('knowledge_base_desc')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="btn-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            New Article
          </button>
          <button
            onClick={() => invalidate()}
            className="p-2 hover:bg-[var(--color-accent-blue)] hover:text-white"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <ErrorBox error={error} />

      {/* Search bar */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-muted)]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search articles by title, content, or tags..."
          className="input-field w-full pl-10"
        />
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="surface-card p-5 mb-6">
          <h3 className="font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide mb-4">New Article</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="md:col-span-2">
              <label className="mono-label mb-1.5 block">Title *</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => { setNewTitle(e.target.value); setFieldErrors({}); }}
                placeholder="e.g. How to reset a customer password"
                className={`input-field w-full ${fieldErrors.title ? 'border-[var(--color-accent-red)]' : ''}`}
              />
              <FieldError error={fieldErrors.title} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mono-label mb-1.5 block">Dept</label>
                <input
                  type="text"
                  value={newDept}
                  onChange={(e) => setNewDept(e.target.value)}
                  placeholder="(all)"
                  className="input-field w-full"
                />
              </div>
              <div>
                <label className="mono-label mb-1.5 block">Tags</label>
                <input
                  type="text"
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  placeholder="billing, faq"
                  className="input-field w-full"
                />
              </div>
            </div>
          </div>
          <div className="mb-4">
            <label className="mono-label mb-1.5 block">Content *</label>
            <textarea
              value={newBody}
              onChange={(e) => { setNewBody(e.target.value); setFieldErrors({}); }}
              placeholder="Write the article content here... (Markdown supported)"
              rows={8}
              className={`input-field w-full resize-y font-mono ${fieldErrors.body ? 'border-[var(--color-accent-red)]' : ''}`}
            />
            <FieldError error={fieldErrors.body} />
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newPublished}
                onChange={(e) => setNewPublished(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="mono-label">Published</span>
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCreateForm(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={addArticle}
                disabled={!newTitle.trim() || !newBody.trim() || createMutation.isPending}
                className="btn-primary disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Articles list */}
      <div className="surface-card">
        <div className="grid grid-cols-[1fr_80px_100px_100px_80px] border-b border-[var(--color-border)] bg-bg-elevated">
          <div className="px-4 py-3 font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide">Title</div>
          <div className="px-4 py-3 font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide">Dept</div>
          <div className="px-4 py-3 font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide">Tags</div>
          <div className="px-4 py-3 font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide">Status</div>
          <div className="px-4 py-3 font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide"></div>
        </div>

        {isLoading ? (
          <div className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)] font-bold uppercase tracking-wide">
            Loading...
          </div>
        ) : !filtered || filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)] font-bold uppercase tracking-wide">
            {searchQuery ? 'No matching articles' : 'No articles yet'}
          </div>
        ) : (
          filtered.map((a) => (
            <div key={a.id}>
              {editingId === a.id ? (
                /* Inline edit */
                <div className="border-b border-[var(--color-border)] p-4 bg-black/[0.02] dark:bg-white/[0.02]">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    <div className="md:col-span-2">
                      <label className="mono-label mb-1 block">Title</label>
                      <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                        className="input-field w-full" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mono-label mb-1 block">Dept</label>
                        <input type="text" value={editDept} onChange={(e) => setEditDept(e.target.value)} placeholder="(all)"
                          className="input-field w-full" />
                      </div>
                      <div>
                        <label className="mono-label mb-1 block">Tags</label>
                        <input type="text" value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder="tag1, tag2"
                          className="input-field w-full" />
                      </div>
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="mono-label mb-1 block">Content</label>
                    <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={8}
                      className="input-field w-full resize-y font-mono" />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={editPublished} onChange={(e) => setEditPublished(e.target.checked)}
                        className="w-4 h-4" />
                      <span className="mono-label">Published</span>
                    </label>
                    <div className="flex gap-2">
                      <button onClick={() => setEditingId(null)}
                        className="btn-secondary">
                        <X className="h-3 w-3" /> Cancel
                      </button>
                      <button onClick={saveEdit}
                        disabled={!editTitle.trim() || !editBody.trim() || updateMutation.isPending}
                        className="btn-primary disabled:opacity-50">
                        <Check className="h-3 w-3" /> {updateMutation.isPending ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className="grid grid-cols-[1fr_80px_100px_100px_80px] border-b border-[var(--color-border)] group hover:bg-black/[0.02] dark:hover:bg-white/[0.02] cursor-pointer"
                    onClick={() => setPreviewId(previewId === a.id ? null : a.id)}
                  >
                    <div className="px-4 py-3 font-bold text-sm flex items-center gap-2">
                      <BookOpen className="h-3.5 w-3.5 text-[var(--color-text-muted)] shrink-0" />
                      {a.title}
                    </div>
                    <div className="px-4 py-3 text-xs text-[var(--color-text-secondary)] flex items-center">
                      {a.dept || <span className="italic text-[var(--color-text-muted)]">all</span>}
                    </div>
                    <div className="px-4 py-3 text-xs text-[var(--color-text-secondary)] flex items-center gap-1 flex-wrap">
                      {((a.tags as string[]) || []).slice(0, 3).map((t) => (
                        <span key={t} className="px-1.5 py-0.5 bg-bg-elevated text-[9px] font-bold">{t}</span>
                      ))}
                    </div>
                    <div className="px-4 py-3 flex items-center">
                      <span className={`text-[9px] font-bold uppercase tracking-wide ${a.published ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]'}`}>
                        {a.published ? 'Published' : 'Draft'}
                      </span>
                    </div>
                    <div className="px-4 py-3 flex items-center justify-end gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePublished(a); }}
                        className="w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[var(--color-accent-blue)] hover:text-white"
                        title={a.published ? 'Unpublish' : 'Publish'}
                      >
                        {a.published ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); startEdit(a); }}
                        className="w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[var(--color-accent-blue)] hover:text-white"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteMutation.mutate({ id: a.id }); }}
                        disabled={deleteMutation.isPending}
                        className="w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[var(--color-accent-blue)] hover:text-white disabled:opacity-50"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {/* Body preview */}
                  {previewId === a.id && (
                    <div className="px-4 py-4 border-b border-[var(--color-border)] bg-black/[0.02] dark:bg-white/[0.02]">
                      <p className="font-mono text-[8px] uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Article Preview</p>
                      <div className="text-sm whitespace-pre-wrap text-[var(--color-text-secondary)] max-h-96 overflow-y-auto font-mono leading-relaxed">
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
        <div className="mt-3 font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] text-right">
          {filtered.length} article{filtered.length !== 1 ? 's' : ''}
          {articles && filtered.length !== articles.length && ` (of ${articles.length})`}
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { Plus, Trash2, RefreshCw, Pencil, X, Check, BookOpen, Eye, EyeOff, Search } from 'lucide-react';
import ErrorBox from './ErrorBox';

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

  const { data: articles, isLoading, error: fetchError, refetch } = trpc.kb.list.useQuery(
    { includeUnpublished: true }
  );

  const createMutation = trpc.kb.create.useMutation({
    onSuccess: () => {
      setNewTitle('');
      setNewBody('');
      setNewDept('');
      setNewTags('');
      setNewPublished(true);
      setShowCreateForm(false);
      refetch();
    },
  });

  const updateMutation = trpc.kb.update.useMutation({
    onSuccess: () => {
      setEditingId(null);
      refetch();
    },
  });

  const deleteMutation = trpc.kb.delete.useMutation({
    onSuccess: () => refetch(),
  });

  const parseTags = (str: string): string[] =>
    str.split(',').map(s => s.trim()).filter(Boolean);

  const addArticle = () => {
    if (!newTitle.trim() || !newBody.trim()) return;
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
          <h2 className="text-lg font-black uppercase tracking-widest">{t('knowledge_base')}</h2>
          <p className="text-xs uppercase opacity-60 mt-1">{t('knowledge_base_desc')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="flex items-center gap-2 px-4 py-2 bg-black dark:bg-white text-white dark:text-black font-black uppercase text-[10px] tracking-widest"
          >
            <Plus className="h-3.5 w-3.5" />
            New Article
          </button>
          <button
            onClick={() => refetch()}
            className="p-2 hover:bg-black/5 dark:hover:bg-white/5"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <ErrorBox error={error} />

      {/* Search bar */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-40" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search articles by title, content, or tags..."
          className="w-full pl-10 pr-4 py-3 border-2 border-black dark:border-white bg-transparent text-sm font-bold placeholder:opacity-30 outline-none"
        />
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="border-2 border-black dark:border-white p-5 mb-6">
          <h3 className="text-[9px] font-black uppercase tracking-widest opacity-60 mb-4">New Article</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="md:col-span-2">
              <label className="block text-[9px] font-black uppercase tracking-widest opacity-60 mb-1.5">Title *</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. How to reset a customer password"
                className="w-full border-2 border-black dark:border-white bg-transparent p-2.5 text-sm font-bold placeholder:opacity-30 outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest opacity-60 mb-1.5">Dept</label>
                <input
                  type="text"
                  value={newDept}
                  onChange={(e) => setNewDept(e.target.value)}
                  placeholder="(all)"
                  className="w-full border-2 border-black dark:border-white bg-transparent p-2.5 text-sm font-bold placeholder:opacity-30 outline-none"
                />
              </div>
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest opacity-60 mb-1.5">Tags</label>
                <input
                  type="text"
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  placeholder="billing, faq"
                  className="w-full border-2 border-black dark:border-white bg-transparent p-2.5 text-sm font-bold placeholder:opacity-30 outline-none"
                />
              </div>
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-[9px] font-black uppercase tracking-widest opacity-60 mb-1.5">Content *</label>
            <textarea
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              placeholder="Write the article content here... (Markdown supported)"
              rows={8}
              className="w-full border-2 border-black dark:border-white bg-transparent p-2.5 text-sm font-bold placeholder:opacity-30 outline-none resize-y font-mono"
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newPublished}
                onChange={(e) => setNewPublished(e.target.checked)}
                className="w-4 h-4 accent-black dark:accent-white"
              />
              <span className="text-[10px] font-black uppercase tracking-widest">Published</span>
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest hover:bg-black/5 dark:hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={addArticle}
                disabled={!newTitle.trim() || !newBody.trim() || createMutation.isPending}
                className="flex items-center gap-2 px-6 py-2.5 bg-black dark:bg-white text-white dark:text-black font-black uppercase text-xs tracking-widest disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Articles list */}
      <div className="border-2 border-black dark:border-white">
        <div className="grid grid-cols-[1fr_80px_100px_100px_80px] border-b-2 border-black dark:border-white bg-black/5 dark:bg-white/5">
          <div className="px-4 py-3 text-[9px] font-black uppercase tracking-widest opacity-60">Title</div>
          <div className="px-4 py-3 text-[9px] font-black uppercase tracking-widest opacity-60">Dept</div>
          <div className="px-4 py-3 text-[9px] font-black uppercase tracking-widest opacity-60">Tags</div>
          <div className="px-4 py-3 text-[9px] font-black uppercase tracking-widest opacity-60">Status</div>
          <div className="px-4 py-3 text-[9px] font-black uppercase tracking-widest opacity-60"></div>
        </div>

        {isLoading ? (
          <div className="px-4 py-8 text-center text-sm opacity-40 font-black uppercase tracking-widest">
            Loading...
          </div>
        ) : !filtered || filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm opacity-40 font-black uppercase tracking-widest">
            {searchQuery ? 'No matching articles' : 'No articles yet'}
          </div>
        ) : (
          filtered.map((a) => (
            <div key={a.id}>
              {editingId === a.id ? (
                /* Inline edit */
                <div className="border-b border-black/20 dark:border-white/20 p-4 bg-black/[0.02] dark:bg-white/[0.02]">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    <div className="md:col-span-2">
                      <label className="block text-[8px] font-black uppercase tracking-widest opacity-40 mb-1">Title</label>
                      <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm font-bold outline-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[8px] font-black uppercase tracking-widest opacity-40 mb-1">Dept</label>
                        <input type="text" value={editDept} onChange={(e) => setEditDept(e.target.value)} placeholder="(all)"
                          className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm font-bold placeholder:opacity-30 outline-none" />
                      </div>
                      <div>
                        <label className="block text-[8px] font-black uppercase tracking-widest opacity-40 mb-1">Tags</label>
                        <input type="text" value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder="tag1, tag2"
                          className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm font-bold placeholder:opacity-30 outline-none" />
                      </div>
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="block text-[8px] font-black uppercase tracking-widest opacity-40 mb-1">Content</label>
                    <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={8}
                      className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm font-bold outline-none resize-y font-mono" />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={editPublished} onChange={(e) => setEditPublished(e.target.checked)}
                        className="w-4 h-4 accent-black dark:accent-white" />
                      <span className="text-[10px] font-black uppercase tracking-widest">Published</span>
                    </label>
                    <div className="flex gap-2">
                      <button onClick={() => setEditingId(null)}
                        className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-black uppercase tracking-widest hover:bg-black/5 dark:hover:bg-white/5">
                        <X className="h-3 w-3" /> Cancel
                      </button>
                      <button onClick={saveEdit}
                        disabled={!editTitle.trim() || !editBody.trim() || updateMutation.isPending}
                        className="flex items-center gap-1.5 px-4 py-2 bg-black dark:bg-white text-white dark:text-black text-[10px] font-black uppercase tracking-widest disabled:opacity-50">
                        <Check className="h-3 w-3" /> {updateMutation.isPending ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className="grid grid-cols-[1fr_80px_100px_100px_80px] border-b border-black/20 dark:border-white/20 group hover:bg-black/[0.02] dark:hover:bg-white/[0.02] cursor-pointer"
                    onClick={() => setPreviewId(previewId === a.id ? null : a.id)}
                  >
                    <div className="px-4 py-3 font-bold text-sm flex items-center gap-2">
                      <BookOpen className="h-3.5 w-3.5 opacity-40 shrink-0" />
                      {a.title}
                    </div>
                    <div className="px-4 py-3 text-xs opacity-60 flex items-center">
                      {a.dept || <span className="italic opacity-40">all</span>}
                    </div>
                    <div className="px-4 py-3 text-xs opacity-60 flex items-center gap-1 flex-wrap">
                      {((a.tags as string[]) || []).slice(0, 3).map((t) => (
                        <span key={t} className="px-1.5 py-0.5 bg-black/5 dark:bg-white/5 text-[9px] font-bold">{t}</span>
                      ))}
                    </div>
                    <div className="px-4 py-3 flex items-center">
                      <span className={`text-[9px] font-black uppercase tracking-widest ${a.published ? 'opacity-60' : 'text-amber-600 dark:text-amber-400'}`}>
                        {a.published ? 'Published' : 'Draft'}
                      </span>
                    </div>
                    <div className="px-4 py-3 flex items-center justify-end gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePublished(a); }}
                        className="w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 transition-opacity"
                        title={a.published ? 'Unpublish' : 'Publish'}
                      >
                        {a.published ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); startEdit(a); }}
                        className="w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 transition-opacity"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteMutation.mutate({ id: a.id }); }}
                        disabled={deleteMutation.isPending}
                        className="w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 transition-opacity disabled:opacity-50"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {/* Body preview */}
                  {previewId === a.id && (
                    <div className="px-4 py-4 border-b border-black/20 dark:border-white/20 bg-black/[0.02] dark:bg-white/[0.02]">
                      <p className="text-[8px] font-black uppercase tracking-widest opacity-40 mb-2">Article Preview</p>
                      <div className="text-sm whitespace-pre-wrap opacity-80 max-h-96 overflow-y-auto font-mono leading-relaxed">
                        {a.body}
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
        <div className="mt-3 text-[9px] font-black uppercase tracking-widest opacity-30 text-right">
          {filtered.length} article{filtered.length !== 1 ? 's' : ''}
          {articles && filtered.length !== articles.length && ` (of ${articles.length})`}
        </div>
      )}
    </div>
  );
}

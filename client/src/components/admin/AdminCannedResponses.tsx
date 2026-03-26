import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { Plus, Trash2, RefreshCw, Pencil, X, Check, MessageSquareText } from 'lucide-react';
import ErrorBox from './ErrorBox';

interface CannedResponse {
  id: string;
  dept: string | null;
  title: string;
  body: string;
  shortcut: string | null;
  createdAt: string;
}

export default function AdminCannedResponses() {
  const t = useT();

  // Create form state
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newDept, setNewDept] = useState('');
  const [newShortcut, setNewShortcut] = useState('');

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editDept, setEditDept] = useState('');
  const [editShortcut, setEditShortcut] = useState('');

  // Expanded row (to preview body)
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: responses, isLoading, error: fetchError, refetch } = trpc.cannedResponse.list.useQuery();

  const createMutation = trpc.cannedResponse.create.useMutation({
    onSuccess: () => {
      setNewTitle('');
      setNewBody('');
      setNewDept('');
      setNewShortcut('');
      refetch();
    },
  });

  const updateMutation = trpc.cannedResponse.update.useMutation({
    onSuccess: () => {
      setEditingId(null);
      refetch();
    },
  });

  const deleteMutation = trpc.cannedResponse.delete.useMutation({
    onSuccess: () => refetch(),
  });

  const addResponse = () => {
    if (!newTitle.trim() || !newBody.trim()) return;
    createMutation.mutate({
      title: newTitle.trim(),
      body: newBody.trim(),
      dept: newDept.trim() || undefined,
      shortcut: newShortcut.trim() || undefined,
    });
  };

  const startEdit = (r: CannedResponse) => {
    setEditingId(r.id);
    setEditTitle(r.title);
    setEditBody(r.body);
    setEditDept(r.dept || '');
    setEditShortcut(r.shortcut || '');
  };

  const saveEdit = () => {
    if (!editingId || !editTitle.trim() || !editBody.trim()) return;
    updateMutation.mutate({
      id: editingId,
      title: editTitle.trim(),
      body: editBody.trim(),
      dept: editDept.trim() || null,
      shortcut: editShortcut.trim() || null,
    });
  };

  const cancelEdit = () => setEditingId(null);

  const deleteResponse = (id: string) => {
    deleteMutation.mutate({ id });
  };

  const error = fetchError?.message || createMutation.error?.message || updateMutation.error?.message || deleteMutation.error?.message;

  return (
    <div className="max-w-4xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-black uppercase tracking-widest">{t('canned_responses')}</h2>
          <p className="text-xs uppercase opacity-60 mt-1">{t('canned_responses_desc')}</p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 hover:bg-black/5 dark:hover:bg-white/5"
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <ErrorBox error={error} />

      {/* Create new canned response */}
      <div className="border-2 border-black dark:border-white p-5 mb-6">
        <h3 className="text-[9px] font-black uppercase tracking-widest opacity-60 mb-4">Create New Response</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-[9px] font-black uppercase tracking-widest opacity-60 mb-1.5">Title *</label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Greeting"
              className="w-full border-2 border-black dark:border-white bg-transparent p-2.5 text-sm font-bold placeholder:opacity-30 outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[9px] font-black uppercase tracking-widest opacity-60 mb-1.5">Department</label>
              <input
                type="text"
                value={newDept}
                onChange={(e) => setNewDept(e.target.value)}
                placeholder="e.g. DSC (optional)"
                className="w-full border-2 border-black dark:border-white bg-transparent p-2.5 text-sm font-bold placeholder:opacity-30 outline-none"
              />
            </div>
            <div>
              <label className="block text-[9px] font-black uppercase tracking-widest opacity-60 mb-1.5">Shortcut</label>
              <input
                type="text"
                value={newShortcut}
                onChange={(e) => setNewShortcut(e.target.value)}
                placeholder="e.g. /greet (optional)"
                className="w-full border-2 border-black dark:border-white bg-transparent p-2.5 text-sm font-bold placeholder:opacity-30 outline-none"
              />
            </div>
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-[9px] font-black uppercase tracking-widest opacity-60 mb-1.5">Body *</label>
          <textarea
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder="Hello {{agentName}}, how can I help you today?"
            rows={3}
            className="w-full border-2 border-black dark:border-white bg-transparent p-2.5 text-sm font-bold placeholder:opacity-30 outline-none resize-y"
          />
          <p className="text-[8px] font-black uppercase tracking-widest opacity-30 mt-1">
            Variables: {'{{agentName}}'} {'{{supportName}}'} {'{{ticketId}}'}
          </p>
        </div>
        <div className="flex justify-end">
          <button
            onClick={addResponse}
            disabled={!newTitle.trim() || !newBody.trim() || createMutation.isPending}
            className="flex items-center gap-2 px-6 py-2.5 bg-black dark:bg-white text-white dark:text-black font-black uppercase text-xs tracking-widest disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            {createMutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>

      {/* Responses list */}
      <div className="border-2 border-black dark:border-white">
        <div className="grid grid-cols-[1fr_100px_100px_80px] border-b-2 border-black dark:border-white bg-black/5 dark:bg-white/5">
          <div className="px-4 py-3 text-[9px] font-black uppercase tracking-widest opacity-60">Title</div>
          <div className="px-4 py-3 text-[9px] font-black uppercase tracking-widest opacity-60">Dept</div>
          <div className="px-4 py-3 text-[9px] font-black uppercase tracking-widest opacity-60">Shortcut</div>
          <div className="px-4 py-3 text-[9px] font-black uppercase tracking-widest opacity-60"></div>
        </div>

        {isLoading ? (
          <div className="px-4 py-8 text-center text-sm opacity-40 font-black uppercase tracking-widest">
            Loading...
          </div>
        ) : !responses || responses.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm opacity-40 font-black uppercase tracking-widest">
            No canned responses yet
          </div>
        ) : (
          responses.map((r) => (
            <div key={r.id}>
              {editingId === r.id ? (
                /* Inline edit form */
                <div className="border-b border-black/20 dark:border-white/20 p-4 bg-black/[0.02] dark:bg-white/[0.02]">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    <div>
                      <label className="block text-[8px] font-black uppercase tracking-widest opacity-40 mb-1">Title</label>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm font-bold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[8px] font-black uppercase tracking-widest opacity-40 mb-1">Dept</label>
                      <input
                        type="text"
                        value={editDept}
                        onChange={(e) => setEditDept(e.target.value)}
                        placeholder="(global)"
                        className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm font-bold placeholder:opacity-30 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[8px] font-black uppercase tracking-widest opacity-40 mb-1">Shortcut</label>
                      <input
                        type="text"
                        value={editShortcut}
                        onChange={(e) => setEditShortcut(e.target.value)}
                        placeholder="(none)"
                        className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm font-bold placeholder:opacity-30 outline-none"
                      />
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="block text-[8px] font-black uppercase tracking-widest opacity-40 mb-1">Body</label>
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={3}
                      className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm font-bold outline-none resize-y"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={cancelEdit}
                      className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-black uppercase tracking-widest hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      <X className="h-3 w-3" /> Cancel
                    </button>
                    <button
                      onClick={saveEdit}
                      disabled={!editTitle.trim() || !editBody.trim() || updateMutation.isPending}
                      className="flex items-center gap-1.5 px-4 py-2 bg-black dark:bg-white text-white dark:text-black text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
                    >
                      <Check className="h-3 w-3" /> {updateMutation.isPending ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                /* Normal row */
                <>
                  <div
                    className="grid grid-cols-[1fr_100px_100px_80px] border-b border-black/20 dark:border-white/20 group hover:bg-black/[0.02] dark:hover:bg-white/[0.02] cursor-pointer"
                    onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  >
                    <div className="px-4 py-3 font-bold text-sm flex items-center gap-2">
                      <MessageSquareText className="h-3.5 w-3.5 opacity-40 shrink-0" />
                      {r.title}
                    </div>
                    <div className="px-4 py-3 text-xs opacity-60 flex items-center">
                      {r.dept || <span className="italic opacity-40">global</span>}
                    </div>
                    <div className="px-4 py-3 text-xs font-mono opacity-60 flex items-center">
                      {r.shortcut || <span className="italic opacity-40">—</span>}
                    </div>
                    <div className="px-4 py-3 flex items-center justify-end gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); startEdit(r); }}
                        className="w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 transition-opacity"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteResponse(r.id); }}
                        disabled={deleteMutation.isPending}
                        className="w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 transition-opacity disabled:opacity-50"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {/* Expanded body preview */}
                  {expandedId === r.id && (
                    <div className="px-4 py-3 border-b border-black/20 dark:border-white/20 bg-black/[0.02] dark:bg-white/[0.02]">
                      <p className="text-[8px] font-black uppercase tracking-widest opacity-40 mb-1.5">Body Preview</p>
                      <p className="text-sm whitespace-pre-wrap opacity-80">{r.body}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>

      {responses && responses.length > 0 && (
        <div className="mt-3 text-[9px] font-black uppercase tracking-widest opacity-30 text-right">
          {responses.length} response{responses.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

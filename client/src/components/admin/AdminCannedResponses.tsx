import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { Plus, Trash2, RefreshCw, Pencil, X, Check, MessageSquareText } from 'lucide-react';
import ErrorBox from './ErrorBox';
import BionicText from '../BionicText';
import useStore from '../../store/useStore';

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
  const { bionicReading } = useStore();

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
          <h2 className="text-lg font-bold uppercase tracking-wide">{t('canned_responses')}</h2>
          <p className="text-xs uppercase text-[var(--color-text-secondary)] mt-1">{t('canned_responses_desc')}</p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 hover:bg-[var(--color-accent-blue)] hover:text-white"
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <ErrorBox error={error} />

      {/* Create new canned response */}
      <div className="surface-card p-5 mb-6">
        <h3 className="font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide mb-4">Create New Response</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="mono-label mb-1.5 block">Title *</label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Greeting"
              className="input-field w-full"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mono-label mb-1.5 block">Department</label>
              <input
                type="text"
                value={newDept}
                onChange={(e) => setNewDept(e.target.value)}
                placeholder="e.g. DSC (optional)"
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="mono-label mb-1.5 block">Shortcut</label>
              <input
                type="text"
                value={newShortcut}
                onChange={(e) => setNewShortcut(e.target.value)}
                placeholder="e.g. /greet (optional)"
                className="input-field w-full"
              />
            </div>
          </div>
        </div>
        <div className="mb-4">
          <label className="mono-label mb-1.5 block">Body *</label>
          <textarea
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder="Hello {{agentName}}, how can I help you today?"
            rows={3}
            className="input-field w-full resize-y"
          />
          <p className="text-[8px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mt-1">
            Variables: {'{{agentName}}'} {'{{supportName}}'} {'{{ticketId}}'}
          </p>
        </div>
        <div className="flex justify-end">
          <button
            onClick={addResponse}
            disabled={!newTitle.trim() || !newBody.trim() || createMutation.isPending}
            className="btn-primary disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            {createMutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>

      {/* Responses list */}
      <div className="surface-card">
        <div className="grid grid-cols-[1fr_100px_100px_80px] border-b border-[var(--color-border)] bg-bg-elevated">
          <div className="px-4 py-3 font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide">Title</div>
          <div className="px-4 py-3 font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide">Dept</div>
          <div className="px-4 py-3 font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide">Shortcut</div>
          <div className="px-4 py-3 font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide"></div>
        </div>

        {isLoading ? (
          <div className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)] font-bold uppercase tracking-wide">
            Loading...
          </div>
        ) : !responses || responses.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)] font-bold uppercase tracking-wide">
            No canned responses yet
          </div>
        ) : (
          responses.map((r) => (
            <div key={r.id}>
              {editingId === r.id ? (
                /* Inline edit form */
                <div className="border-b border-[var(--color-border)] p-4 bg-black/[0.02] dark:bg-white/[0.02]">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    <div>
                      <label className="block text-[8px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Title</label>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="input-field w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-[8px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Dept</label>
                      <input
                        type="text"
                        value={editDept}
                        onChange={(e) => setEditDept(e.target.value)}
                        placeholder="(global)"
                        className="input-field w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-[8px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Shortcut</label>
                      <input
                        type="text"
                        value={editShortcut}
                        onChange={(e) => setEditShortcut(e.target.value)}
                        placeholder="(none)"
                        className="input-field w-full"
                      />
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="block text-[8px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Body</label>
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={3}
                      className="input-field w-full resize-y"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={cancelEdit}
                      className="btn-secondary"
                    >
                      <X className="h-3 w-3" /> Cancel
                    </button>
                    <button
                      onClick={saveEdit}
                      disabled={!editTitle.trim() || !editBody.trim() || updateMutation.isPending}
                      className="btn-primary disabled:opacity-50"
                    >
                      <Check className="h-3 w-3" /> {updateMutation.isPending ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                /* Normal row */
                <>
                  <div
                    className="grid grid-cols-[1fr_100px_100px_80px] border-b border-[var(--color-border)] group hover:bg-black/[0.02] dark:hover:bg-white/[0.02] cursor-pointer"
                    onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  >
                    <div className="px-4 py-3 font-bold text-sm flex items-center gap-2">
                      <MessageSquareText className="h-3.5 w-3.5 opacity-40 shrink-0" />
                      {r.title}
                    </div>
                    <div className="px-4 py-3 text-xs text-[var(--color-text-secondary)] flex items-center">
                      {r.dept || <span className="italic text-[var(--color-text-muted)]">global</span>}
                    </div>
                    <div className="px-4 py-3 text-xs font-mono text-[var(--color-text-secondary)] flex items-center">
                      {r.shortcut || <span className="italic text-[var(--color-text-muted)]">—</span>}
                    </div>
                    <div className="px-4 py-3 flex items-center justify-end gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); startEdit(r); }}
                        className="w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[var(--color-accent-blue)] hover:text-white"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteResponse(r.id); }}
                        disabled={deleteMutation.isPending}
                        className="w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[var(--color-accent-blue)] hover:text-white disabled:opacity-50"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {/* Expanded body preview */}
                  {expandedId === r.id && (
                    <div className="px-4 py-3 border-b border-[var(--color-border)] bg-black/[0.02] dark:bg-white/[0.02]">
                      <p className="text-[8px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1.5">Body Preview</p>
                      <p className="text-sm whitespace-pre-wrap opacity-80">{bionicReading ? <BionicText text={r.body} /> : r.body}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>

      {responses && responses.length > 0 && (
        <div className="mt-3 font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] text-right">
          {responses.length} response{responses.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { Plus, Trash2, RefreshCw, Pencil, Check, X } from 'lucide-react';
import ErrorBox from './ErrorBox';
import ConfirmDialog from '../ConfirmDialog';
import Toast from '../Toast';
import { LABEL_COLORS as COLORS, COLOR_BG_MAP } from '../../utils/labelColors';

export default function AdminLabels() {
  const t = useT();
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<typeof COLORS[number]['key']>('indigo');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState<typeof COLORS[number]['key']>('indigo');

  const { data: labels, isLoading, error: fetchError, refetch } = trpc.label.list.useQuery();

  const createMutation = trpc.label.create.useMutation({
    onSuccess: () => {
      setNewName('');
      refetch();
    },
    onError: (err) => setToast({ message: err.message, type: 'error' }),
  });

  const updateMutation = trpc.label.update.useMutation({
    onSuccess: () => {
      setEditingId(null);
      refetch();
    },
    onError: (err) => setToast({ message: err.message, type: 'error' }),
  });

  const deleteMutation = trpc.label.delete.useMutation({
    onSuccess: () => {
      setDeletingId(null);
      refetch();
    },
    onError: (err) => {
      setDeletingId(null);
      setToast({ message: err.message, type: 'error' });
    },
  });

  const addLabel = () => {
    if (!newName.trim()) return;
    createMutation.mutate({ name: newName, color: newColor });
  };

  const startEdit = (id: string, name: string, color: string) => {
    setEditingId(id);
    setEditName(name);
    setEditColor(color as typeof COLORS[number]['key']);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = () => {
    if (!editingId || !editName.trim()) return;
    updateMutation.mutate({ id: editingId, name: editName, color: editColor });
  };

  const confirmDeleteLabel = (id: string, name: string) => {
    setConfirmDelete({ id, name });
  };

  const executeDelete = () => {
    if (!confirmDelete) return;
    setDeletingId(confirmDelete.id);
    deleteMutation.mutate(confirmDelete.id);
    setConfirmDelete(null);
  };

  const error = fetchError?.message || createMutation.error?.message || updateMutation.error?.message || deleteMutation.error?.message;

  return (
    <div className="max-w-3xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-bold uppercase tracking-wide">{t('labels') || 'Labels'}</h2>
          <p className="text-xs uppercase text-[var(--color-text-secondary)] mt-1">{t('labels_desc') || 'Categorize and tag conversations'}</p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 hover:bg-[var(--color-accent-blue)] hover:text-white"
          title={t('refresh') || 'Refresh'}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <ErrorBox error={error} />

      {/* Create new label */}
      <div className="surface-card p-5 mb-6">
        <h3 className="font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide mb-4">{t('create_new_label') || 'Create New Label'}</h3>
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <label className="mono-label mb-1.5 block">{t('label_name') || 'Name'} *</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addLabel()}
              placeholder={t('label_name_placeholder') || 'e.g. Bug Report'}
              className="input-field w-full"
              maxLength={50}
            />
          </div>
          <div>
            <label className="mono-label mb-1.5 block">{t('label_color') || 'Color'} *</label>
            <div className="flex gap-1.5 p-1.5 border border-[var(--color-border)]" role="radiogroup" aria-label={t('label_color') || 'Color'}>
              {COLORS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setNewColor(c.key)}
                  role="radio"
                  aria-checked={newColor === c.key}
                  aria-label={c.key}
                  className={`w-6 h-6 ${c.bg} ${
                    newColor === c.key
                      ? 'ring-2 ring-offset-2 ring-offset-[var(--color-bg-surface)] ' + c.ring
                      : 'opacity-50 hover:opacity-80'
                  }`}
                />
              ))}
            </div>
          </div>
          <button
            onClick={addLabel}
            disabled={!newName.trim() || createMutation.isPending}
            className="btn-primary disabled:opacity-50 shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            {createMutation.isPending ? (t('adding_label') || 'Adding...') : (t('add_label') || 'Add')}
          </button>
        </div>
      </div>

      {/* Labels list */}
      <div className="surface-card">
        <div className="grid grid-cols-[auto_1fr_auto] border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
          <div className="px-4 py-3 font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide w-16 text-center">{t('label_color') || 'Color'}</div>
          <div className="px-4 py-3 font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide">{t('labels') || 'Label'}</div>
          <div className="px-4 py-3 font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide"></div>
        </div>

        {isLoading ? (
          <div className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)] font-bold uppercase tracking-wide">
            {t('loading') || 'Loading...'}
          </div>
        ) : !labels || labels.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)] font-bold uppercase tracking-wide">
            {t('no_labels') || 'No labels created yet'}
          </div>
        ) : (
          labels.map((l) => (
            <div
              key={l.id}
              className="grid grid-cols-[auto_1fr_auto] border-b border-[var(--color-border)] group hover:bg-[var(--color-bg-elevated)]"
            >
              {editingId === l.id ? (
                <>
                  <div className="px-4 py-2 w-16 flex items-center justify-center">
                    <div className="flex gap-1">
                      {COLORS.map((c) => (
                        <button
                          key={c.key}
                          onClick={() => setEditColor(c.key)}
                          aria-label={c.key}
                          className={`w-4 h-4 ${c.bg} ${editColor === c.key ? 'ring-1 ring-offset-1 ring-offset-[var(--color-bg-surface)] ' + c.ring : 'opacity-40'}`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="px-4 py-2 flex items-center">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                      className="input-field w-full text-sm"
                      maxLength={50}
                      autoFocus
                    />
                  </div>
                  <div className="px-4 py-2 flex items-center gap-1">
                    <button
                      onClick={saveEdit}
                      disabled={!editName.trim() || updateMutation.isPending}
                      className="w-7 h-7 flex items-center justify-center hover:bg-[var(--color-accent-blue)] hover:text-white disabled:opacity-50"
                      title={t('save_label') || 'Save'}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="w-7 h-7 flex items-center justify-center hover:bg-[var(--color-accent-blue)] hover:text-white"
                      title={t('cancel') || 'Cancel'}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="px-4 py-3 w-16 flex items-center justify-center">
                    <div className={`w-3.5 h-3.5 ${COLOR_BG_MAP[l.color] ?? 'bg-slate-500'}`} />
                  </div>
                  <div className="px-4 py-3 font-bold text-sm flex items-center">{l.name}</div>
                  <div className="px-4 py-3 flex items-center gap-1">
                    <button
                      onClick={() => startEdit(l.id, l.name, l.color)}
                      className="w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[var(--color-accent-blue)] hover:text-white"
                      title={t('edit_label') || 'Edit'}
                      aria-label={`${t('edit_label') || 'Edit'} ${l.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => confirmDeleteLabel(l.id, l.name)}
                      disabled={deletingId === l.id}
                      className="w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[var(--color-accent-blue)] hover:text-white disabled:opacity-50"
                      title={t('delete') || 'Delete'}
                      aria-label={`${t('delete') || 'Delete'} ${l.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {labels && labels.length > 0 && (
        <div className="mt-3 font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] text-right">
          {labels.length} {t('labels') || 'label(s)'}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={t('delete_label_title') || 'Delete Label'}
          message={t('delete_label_message') || 'This will remove the label from all tickets. This action cannot be undone.'}
          confirmLabel={t('delete') || 'Delete'}
          onConfirm={executeDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

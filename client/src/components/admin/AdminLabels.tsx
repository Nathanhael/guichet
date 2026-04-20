import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { Plus, Trash2, RefreshCw, Pencil, Check, X } from 'lucide-react';
import ErrorBox from './ErrorBox';
import ConfirmDialog from '../ConfirmDialog';
import FieldError from '../FieldError';
import Toast from '../Toast';
import { LABEL_COLORS as COLORS, COLOR_BG_MAP } from '../../utils/labelColors';
import { labelCreateSchema, validateForm, FieldErrors } from '../../validation/adminSchemas';

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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const utils = trpc.useUtils();
  const { data: labels, isLoading, error: fetchError } = trpc.label.list.useQuery();
  const invalidate = () => utils.label.list.invalidate();

  const createMutation = trpc.label.create.useMutation({
    onSuccess: () => {
      setNewName('');
      invalidate();
    },
    onError: (err) => setToast({ message: err.message, type: 'error' }),
  });

  const updateMutation = trpc.label.update.useMutation({
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
    onError: (err) => setToast({ message: err.message, type: 'error' }),
  });

  const deleteMutation = trpc.label.delete.useMutation({
    onSuccess: () => {
      setDeletingId(null);
      invalidate();
    },
    onError: (err) => {
      setDeletingId(null);
      setToast({ message: err.message, type: 'error' });
    },
  });

  const addLabel = () => {
    const errors = validateForm(labelCreateSchema, { name: newName, color: newColor });
    if (errors) { setFieldErrors(errors); return; }
    setFieldErrors({});
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

  const CARD = 'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)]';
  const INPUT = 'w-full h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';
  const ICON_BTN = 'w-8 h-8 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors disabled:opacity-50';

  return (
    <div className="max-w-3xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">{t('labels') || 'Labels'}</h2>
          <p className="text-[13px] text-[var(--color-ink-muted)] mt-1">{t('labels_desc') || 'Categorize and tag conversations'}</p>
        </div>
        <button
          onClick={() => invalidate()}
          className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors"
          title={t('refresh') || 'Refresh'}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <ErrorBox error={error} />

      {/* Create new label */}
      <div className={`${CARD} p-5 mb-6`}>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] mb-4">{t('create_new_label') || 'Create New Label'}</h3>
        <div className="flex items-end gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="text-[12px] font-medium text-[var(--color-ink-soft)] mb-1.5 block">{t('label_name') || 'Name'} *</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => { setNewName(e.target.value); setFieldErrors({}); }}
              onKeyDown={(e) => e.key === 'Enter' && addLabel()}
              placeholder={t('label_name_placeholder') || 'e.g. Bug Report'}
              className={`${INPUT} ${fieldErrors.name ? 'border-[var(--color-urgent)]' : ''}`}
              maxLength={50}
            />
            <FieldError error={fieldErrors.name} />
          </div>
          <div>
            <label className="text-[12px] font-medium text-[var(--color-ink-soft)] mb-1.5 block">{t('label_color') || 'Color'} *</label>
            <div className="flex gap-1.5 p-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)]" role="radiogroup" aria-label={t('label_color') || 'Color'}>
              {COLORS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setNewColor(c.key)}
                  role="radio"
                  aria-checked={newColor === c.key}
                  aria-label={c.key}
                  className={`w-6 h-6 rounded-full ${c.bg} transition-opacity ${
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
            className="h-9 px-4 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-accent)] hover:brightness-110 text-white text-[13px] font-medium shadow-[var(--shadow-soft)] disabled:opacity-50 transition-all shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            {createMutation.isPending ? (t('adding_label') || 'Adding…') : (t('add_label') || 'Add')}
          </button>
        </div>
      </div>

      {/* Labels list */}
      <div className={`${CARD} overflow-hidden`}>
        <div className="grid grid-cols-[auto_1fr_auto] border-b border-[var(--color-border)]">
          <div className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)] w-16 text-center">{t('label_color') || 'Color'}</div>
          <div className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">{t('labels') || 'Label'}</div>
          <div className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]"></div>
        </div>

        {isLoading ? (
          <div className="px-4 py-8 text-center text-[13px] text-[var(--color-ink-muted)]">
            {t('loading') || 'Loading…'}
          </div>
        ) : !labels || labels.length === 0 ? (
          <div className="px-4 py-12 text-center text-[13px] text-[var(--color-ink-muted)]">
            {t('no_labels') || 'No labels created yet'}
          </div>
        ) : (
          labels.map((l) => (
            <div
              key={l.id}
              className="grid grid-cols-[auto_1fr_auto] border-b border-[var(--color-border)] last:border-b-0 group hover:bg-[var(--color-hover)] transition-colors"
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
                          className={`w-4 h-4 rounded-full ${c.bg} ${editColor === c.key ? 'ring-1 ring-offset-1 ring-offset-[var(--color-bg-surface)] ' + c.ring : 'opacity-40'}`}
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
                      className={INPUT}
                      maxLength={50}
                      autoFocus
                    />
                  </div>
                  <div className="px-4 py-2 flex items-center gap-1">
                    <button
                      onClick={saveEdit}
                      disabled={!editName.trim() || updateMutation.isPending}
                      className={ICON_BTN}
                      title={t('save_label') || 'Save'}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className={ICON_BTN}
                      title={t('cancel') || 'Cancel'}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="px-4 py-3 w-16 flex items-center justify-center">
                    <div className={`w-3.5 h-3.5 rounded-full ${COLOR_BG_MAP[l.color] ?? 'bg-slate-500'}`} />
                  </div>
                  <div className="px-4 py-3 text-[14px] font-medium text-[var(--color-ink)] flex items-center">{l.name}</div>
                  <div className="px-4 py-3 flex items-center gap-1">
                    <button
                      onClick={() => startEdit(l.id, l.name, l.color)}
                      className={`${ICON_BTN} opacity-0 group-hover:opacity-100`}
                      title={t('edit_label') || 'Edit'}
                      aria-label={`${t('edit_label') || 'Edit'} ${l.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => confirmDeleteLabel(l.id, l.name)}
                      disabled={deletingId === l.id}
                      className={`${ICON_BTN} opacity-0 group-hover:opacity-100`}
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
        <div className="mt-3 text-[12px] text-[var(--color-ink-muted)] text-right">
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

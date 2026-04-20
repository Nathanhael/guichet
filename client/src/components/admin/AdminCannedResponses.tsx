import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { Plus, Trash2, RefreshCw, Pencil, X, Check, MessageSquareText } from 'lucide-react';
import ErrorBox from './ErrorBox';
import FieldError from '../FieldError';
import BionicText from '../BionicText';
import { cannedResponseCreateSchema, validateForm, FieldErrors } from '../../validation/adminSchemas';
import { useStoreShallow } from '../../store/useStore';
import { usePartner } from '../../hooks/usePartner';

interface CannedResponse {
  id: string;
  dept: string | null;
  title: string;
  body: string;
  shortcut: string | null;
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

export default function AdminCannedResponses() {
  const t = useT();
  const { bionicReading } = useStoreShallow(s => ({ bionicReading: s.bionicReading }));
  const { manifest } = usePartner();
  const departments = manifest.departments || [];
  const utils = trpc.useUtils();

  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newDept, setNewDept] = useState('');
  const [newShortcut, setNewShortcut] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editDept, setEditDept] = useState('');
  const [editShortcut, setEditShortcut] = useState('');

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const { data: responses, isLoading, error: fetchError, refetch } = trpc.cannedResponse.list.useQuery();

  const invalidate = () => utils.cannedResponse.list.invalidate();

  const createMutation = trpc.cannedResponse.create.useMutation({
    onSuccess: () => {
      setNewTitle('');
      setNewBody('');
      setNewDept('');
      setNewShortcut('');
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
          <h2 className="text-[22px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">{t('canned_responses')}</h2>
          <p className="text-[13px] text-[var(--color-ink-muted)] mt-1">{t('canned_responses_desc')}</p>
        </div>
        <button
          onClick={() => refetch()}
          className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors"
          title={t('refresh') || 'Refresh'}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <ErrorBox error={error} />

      {/* Create new canned response */}
      <div className={`${CARD} p-5 mb-6`}>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] mb-4">Create New Response</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className={LABEL}>Title *</label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => { setNewTitle(e.target.value); setFieldErrors({}); }}
              placeholder="e.g. Greeting"
              className={`${INPUT} ${fieldErrors.title ? 'border-[var(--color-urgent)]' : ''}`}
            />
            <FieldError error={fieldErrors.title} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>Department</label>
              <select
                value={newDept}
                onChange={(e) => setNewDept(e.target.value)}
                className={INPUT}
              >
                <option value="">{t('global') || 'Global (all depts)'}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>Shortcut</label>
              <input
                type="text"
                value={newShortcut}
                onChange={(e) => setNewShortcut(e.target.value)}
                placeholder="e.g. /greet"
                className={INPUT}
              />
            </div>
          </div>
        </div>
        <div className="mb-4">
          <label className={LABEL}>Body *</label>
          <textarea
            value={newBody}
            onChange={(e) => { setNewBody(e.target.value); setFieldErrors({}); }}
            placeholder="Hello {{agentName}}, how can I help you today?"
            rows={3}
            className={`${TEXTAREA} ${fieldErrors.body ? 'border-[var(--color-urgent)]' : ''}`}
          />
          <FieldError error={fieldErrors.body} />
          <p className="text-[11px] text-[var(--color-ink-muted)] mt-1.5">
            Variables: <span className="font-mono">{'{{agentName}}'} {'{{supportName}}'} {'{{ticketId}}'}</span>
          </p>
        </div>
        <div className="flex justify-end">
          <button
            onClick={addResponse}
            disabled={!newTitle.trim() || !newBody.trim() || createMutation.isPending}
            className={PRIMARY_BTN}
          >
            <Plus className="h-3.5 w-3.5" />
            {createMutation.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>

      {/* Responses list */}
      <div className={`${CARD} overflow-hidden`}>
        <div className="grid grid-cols-[1fr_120px_120px_80px] border-b border-[var(--color-border)]">
          <div className={COL_HEAD}>Title</div>
          <div className={COL_HEAD}>Dept</div>
          <div className={COL_HEAD}>Shortcut</div>
          <div className={COL_HEAD}></div>
        </div>

        {isLoading ? (
          <div className="px-4 py-8 text-center text-[13px] text-[var(--color-ink-muted)]">
            {t('loading') || 'Loading…'}
          </div>
        ) : !responses || responses.length === 0 ? (
          <div className="px-4 py-12 text-center text-[13px] text-[var(--color-ink-muted)]">
            No canned responses yet
          </div>
        ) : (
          responses.map((r) => (
            <div key={r.id}>
              {editingId === r.id ? (
                <div className="border-b border-[var(--color-border)] last:border-b-0 p-4 bg-[var(--color-bg-elevated)]">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    <div>
                      <label className={LABEL}>Title</label>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className={INPUT}
                      />
                    </div>
                    <div>
                      <label className={LABEL}>Dept</label>
                      <select
                        value={editDept}
                        onChange={(e) => setEditDept(e.target.value)}
                        className={INPUT}
                      >
                        <option value="">{t('global') || 'Global (all depts)'}</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL}>Shortcut</label>
                      <input
                        type="text"
                        value={editShortcut}
                        onChange={(e) => setEditShortcut(e.target.value)}
                        placeholder="(none)"
                        className={INPUT}
                      />
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className={LABEL}>Body</label>
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={3}
                      className={TEXTAREA}
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={cancelEdit} className={SECONDARY_BTN}>
                      <X className="h-3 w-3" /> Cancel
                    </button>
                    <button
                      onClick={saveEdit}
                      disabled={!editTitle.trim() || !editBody.trim() || updateMutation.isPending}
                      className={PRIMARY_BTN}
                    >
                      <Check className="h-3 w-3" /> {updateMutation.isPending ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className="grid grid-cols-[1fr_120px_120px_80px] border-b border-[var(--color-border)] last:border-b-0 group hover:bg-[var(--color-hover)] transition-colors cursor-pointer"
                    onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  >
                    <div className="px-4 py-3 text-[14px] font-medium text-[var(--color-ink)] flex items-center gap-2">
                      <MessageSquareText className="h-3.5 w-3.5 text-[var(--color-ink-muted)] shrink-0" />
                      {r.title}
                    </div>
                    <div className="px-4 py-3 text-[12px] text-[var(--color-ink-soft)] flex items-center">
                      {r.dept ? (departments.find(d => d.id === r.dept)?.name || r.dept) : <span className="italic text-[var(--color-ink-muted)]">global</span>}
                    </div>
                    <div className="px-4 py-3 text-[12px] font-mono text-[var(--color-ink-soft)] flex items-center">
                      {r.shortcut || <span className="italic font-sans text-[var(--color-ink-muted)]">—</span>}
                    </div>
                    <div className="px-4 py-3 flex items-center justify-end gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); startEdit(r); }}
                        className={`${ICON_BTN} opacity-0 group-hover:opacity-100`}
                        title="Edit"
                        aria-label={`Edit ${r.title}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteResponse(r.id); }}
                        disabled={deleteMutation.isPending}
                        className={`${ICON_BTN} opacity-0 group-hover:opacity-100`}
                        title="Delete"
                        aria-label={`Delete ${r.title}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {expandedId === r.id && (
                    <div className="px-4 py-3 border-b border-[var(--color-border)] last:border-b-0 bg-[var(--color-bg-elevated)]">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] mb-1.5">Body Preview</p>
                      <p className="text-[13px] text-[var(--color-ink)] whitespace-pre-wrap">{bionicReading ? <BionicText text={r.body} /> : r.body}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>

      {responses && responses.length > 0 && (
        <div className="mt-3 text-[12px] text-[var(--color-ink-muted)] text-right">
          {responses.length} response{responses.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

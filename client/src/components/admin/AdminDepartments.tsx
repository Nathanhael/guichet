import { useState, useEffect, useMemo, useRef } from 'react';
import { trpc } from '../../utils/trpc';
import { useStoreShallow } from '../../store/useStore';
import { useT } from '../../i18n';
import { Pencil, Trash2, Check, X, Plus, Building2 } from 'lucide-react';
import Toast from '../Toast';
import { useIsExternalAdmin } from '../../hooks/useIsExternalAdmin';

// Shared Soft Product style constants — mirrors the other admin panels.
const CARD = 'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)]';
const INPUT = 'h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';
const PRIMARY_BTN = 'h-9 px-4 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-accent)] hover:brightness-110 text-white text-[13px] font-medium shadow-[var(--shadow-soft)] disabled:opacity-40 disabled:cursor-not-allowed transition-all';
const SECONDARY_BTN = 'h-9 px-3 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[var(--color-ink)] text-[13px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const DANGER_BTN = 'h-9 px-4 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-urgent)] hover:brightness-110 text-white text-[13px] font-medium shadow-[var(--shadow-soft)] disabled:opacity-40 disabled:cursor-not-allowed transition-all';
const ICON_BTN = 'w-8 h-8 inline-flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const FIELD_LABEL = 'block text-[11px] font-medium text-[var(--color-ink-muted)] mb-1.5';
const COL_HEAD = 'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]';

interface RefField {
  label: string;
  optional?: boolean;
}

interface SlaConfig {
  enabled: boolean;
  firstResponseMinutes: number;
  warnAtPercent: number;
}

interface Department {
  id: string;
  name: string;
  description: string;
  referenceFields: RefField[];
  sla?: SlaConfig;
}

function mapDepts(raw: Array<{ id?: string; name?: string; description?: string; referenceFields?: RefField[]; sla?: SlaConfig }> | undefined | null): Department[] {
  return (raw || []).map(d => ({
    id: d.id || '',
    name: d.name || '',
    description: d.description || '',
    referenceFields: d.referenceFields || [],
    sla: d.sla,
  }));
}

export default function AdminDepartments() {
  const { memberships, activeMembershipId, setMemberships } = useStoreShallow((s) => ({
    memberships: s.memberships,
    activeMembershipId: s.activeMembershipId,
    setMemberships: s.setMemberships,
  }));
  const t = useT();
  const utils = trpc.useUtils();
  const isExternal = useIsExternalAdmin();
  const guestTooltip = t('guest_admin_disabled_tooltip');

  // Fetch departments from server — single source of truth
  const { data: manifest } = trpc.partner.getManifest.useQuery();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Department | null>(null);
  const [deletingIdx, setDeletingIdx] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [slaEditingIdx, setSlaEditingIdx] = useState<number | null>(null);
  const [slaDraft, setSlaDraft] = useState<SlaConfig>({ enabled: true, firstResponseMinutes: 30, warnAtPercent: 75 });

  // Sync server data → local state (only when not actively editing)
  const isEditing = editingIdx !== null;
  const prevDepsRef = useRef<string>('');
  useEffect(() => {
    if (isEditing || isSaving) return;
    const serverDepts = mapDepts((manifest?.departments ?? []) as Array<{ id?: string; name?: string; description?: string; referenceFields?: RefField[]; sla?: SlaConfig }>);
    const key = JSON.stringify(serverDepts);
    if (key !== prevDepsRef.current) {
      prevDepsRef.current = key;
      setDepartments(serverDepts);
    }
  }, [manifest, isEditing, isSaving]);

  // Fetch all partner members for accurate department counts
  const { data: allMembers } = trpc.partner.listMembers.useQuery(
    { limit: 100, offset: 0 },
  );

  const memberCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    let generalistCount = 0;
    (allMembers || []).forEach(m => {
      const deptArr = (m.departments || []) as string[];
      if (deptArr.length === 0) {
        generalistCount++;
      } else {
        deptArr.forEach(deptId => {
          counts[deptId] = (counts[deptId] || 0) + 1;
        });
      }
    });
    // Generalists (no department assignment) can see all departments
    if (generalistCount > 0) {
      departments.forEach(dept => {
        counts[dept.id] = (counts[dept.id] || 0) + generalistCount;
      });
    }
    return counts;
  }, [allMembers, departments]);

  const updateDeptsMutation = trpc.partner.updateDepartments.useMutation({
    onSuccess: (data) => {
      setIsSaving(false);
      setEditingIdx(null);
      setEditDraft(null);

      // Use server-returned departments (with generated IDs) to update local state immediately
      const serverDepts = mapDepts(data.departments);
      setDepartments(serverDepts);
      prevDepsRef.current = JSON.stringify(serverDepts);

      // Invalidate query so it refetches for other consumers
      utils.partner.getManifest.invalidate();

      // Also update Zustand store so other components (AgentView, etc.) see the change
      if (activeMembershipId) {
        const updated = memberships.map(m =>
          m.id === activeMembershipId
            ? { ...m, manifest: { ...m.manifest, departments: serverDepts } }
            : m
        );
        setMemberships(updated);
      }
    },
    onError: (err) => {
      setIsSaving(false);
      setToast({ message: 'Failed to update departments: ' + err.message, type: 'error' });
    }
  });

  const updateSla = trpc.partner.updateDepartmentSla.useMutation({
    onSuccess: () => {
      utils.partner.getManifest.invalidate();
      setSlaEditingIdx(null);
      setToast({ message: 'SLA updated', type: 'success' });
    },
    onError: (e) => setToast({ message: e.message, type: 'error' }),
  });

  function startSlaEdit(idx: number) {
    setDeletingIdx(null);
    setEditingIdx(null);
    setEditDraft(null);
    const existing = departments[idx].sla;
    setSlaDraft(
      existing
        ? { ...existing }
        : { enabled: true, firstResponseMinutes: 30, warnAtPercent: 75 }
    );
    setSlaEditingIdx(idx);
  }

  function cancelSlaEdit() {
    setSlaEditingIdx(null);
  }

  function saveSla() {
    if (slaEditingIdx === null) return;
    const dept = departments[slaEditingIdx];
    if (!dept?.id) {
      setToast({ message: 'Save department before configuring SLA.', type: 'error' });
      return;
    }
    updateSla.mutate({
      departmentId: dept.id,
      sla: slaDraft.enabled ? slaDraft : null,
    });
  }

  function startEdit(idx: number) {
    setDeletingIdx(null);
    setSlaEditingIdx(null);
    setEditingIdx(idx);
    setEditDraft({ ...departments[idx], referenceFields: [...departments[idx].referenceFields] });
  }

  function cancelEdit() {
    // If it was a newly added department with no id, remove it
    if (editDraft && editingIdx !== null && !departments[editingIdx].id) {
      const newDepts = [...departments];
      newDepts.splice(editingIdx, 1);
      setDepartments(newDepts);
    }
    setEditingIdx(null);
    setEditDraft(null);
  }

  function saveEdit() {
    if (!editDraft || editingIdx === null) return;
    if (!editDraft.name.trim()) {
      setToast({ message: 'Department name is required.', type: 'error' });
      return;
    }
    // Check unique labels
    const labels = editDraft.referenceFields.map(f => f.label.trim()).filter(Boolean);
    if (new Set(labels).size !== labels.length) {
      setToast({ message: 'Reference field labels must be unique.', type: 'error' });
      return;
    }

    const newDepts = [...departments];
    newDepts[editingIdx] = {
      ...editDraft,
      referenceFields: editDraft.referenceFields.filter(f => f.label.trim()),
    };
    setDepartments(newDepts);
    setEditingIdx(null);
    setEditDraft(null);

    // Save to server
    setIsSaving(true);
    updateDeptsMutation.mutate({
      departments: newDepts.map(d => ({
        id: d.id || undefined,
        name: d.name.trim(),
        description: d.description.trim(),
        referenceFields: d.referenceFields.filter(f => f.label.trim()),
      }))
    });
  }

  function handleAdd() {
    setDeletingIdx(null);
    const newDept: Department = { id: '', name: '', description: '', referenceFields: [] };
    const newDepts = [...departments, newDept];
    setDepartments(newDepts);
    setEditingIdx(newDepts.length - 1);
    setEditDraft({ ...newDept });
  }

  function startDelete(idx: number) {
    setEditingIdx(null);
    setEditDraft(null);
    setDeletingIdx(idx);
  }

  function confirmDelete() {
    if (deletingIdx === null) return;
    const newDepts = [...departments];
    newDepts.splice(deletingIdx, 1);
    setDepartments(newDepts);
    setDeletingIdx(null);

    setIsSaving(true);
    updateDeptsMutation.mutate({
      departments: newDepts.map(d => ({
        id: d.id || undefined,
        name: d.name.trim(),
        description: d.description.trim(),
        referenceFields: d.referenceFields.filter(f => f.label.trim()),
      }))
    });
  }

  function addRefField() {
    if (!editDraft || editDraft.referenceFields.length >= 3) return;
    setEditDraft({ ...editDraft, referenceFields: [...editDraft.referenceFields, { label: '' }] });
  }

  function removeRefField(fieldIdx: number) {
    if (!editDraft) return;
    const newFields = [...editDraft.referenceFields];
    newFields.splice(fieldIdx, 1);
    setEditDraft({ ...editDraft, referenceFields: newFields });
  }

  function updateRefFieldLabel(fieldIdx: number, label: string) {
    if (!editDraft) return;
    const newFields = [...editDraft.referenceFields];
    newFields[fieldIdx] = { ...newFields[fieldIdx], label };
    setEditDraft({ ...editDraft, referenceFields: newFields });
  }

  function toggleRefFieldOptional(fieldIdx: number) {
    if (!editDraft) return;
    const newFields = [...editDraft.referenceFields];
    newFields[fieldIdx] = { ...newFields[fieldIdx], optional: !newFields[fieldIdx].optional };
    setEditDraft({ ...editDraft, referenceFields: newFields });
  }

  return (
    <div className="max-w-5xl">
      <div className="flex justify-between items-end mb-5">
        <div>
          <h2 className="text-xl font-semibold text-[var(--color-ink)] tracking-tight">Departments</h2>
          <p className="text-[13px] text-[var(--color-ink-soft)] mt-1">{t('manage_departments') || 'Manage your organization structure'}</p>
        </div>
        <button
          onClick={handleAdd}
          disabled={isExternal || isSaving}
          aria-disabled={isExternal || undefined}
          title={isExternal ? guestTooltip : undefined}
          data-guest-disabled={isExternal || undefined}
          className={PRIMARY_BTN}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add department
        </button>
      </div>

      <div className={`${CARD} overflow-hidden`}>
        {/* Header row — uses a grid that mirrors the body rows so columns line up. */}
        <div className="grid grid-cols-[1fr_1fr_1fr_180px_80px] border-b border-[var(--color-border)]">
          <div className={COL_HEAD}>Name</div>
          <div className={COL_HEAD}>Description</div>
          <div className={COL_HEAD}>{t('ref_fields_label') || 'Ref fields'}</div>
          <div className={COL_HEAD}>SLA</div>
          <div className={`${COL_HEAD} text-right`}></div>
        </div>

        {/* Empty state */}
        {departments.length === 0 && (
          <div className="px-4 py-16 text-center">
            <Building2 className="w-10 h-10 mx-auto text-[var(--color-ink-muted)] opacity-50 mb-3" aria-hidden />
            <p className="text-[13px] font-medium text-[var(--color-ink)]">{t('no_departments') || 'No departments configured'}</p>
            <p className="text-[12px] text-[var(--color-ink-muted)] mt-1">{t('no_departments_hint') || 'Add a department to get started.'}</p>
          </div>
        )}

        {/* Rows */}
        {departments.map((dept, idx) => (
          <div key={dept.id || `new-${idx}`}>
            {editingIdx === idx && editDraft ? (
              /* Edit mode — inline editor card */
              <div className="border-b border-[var(--color-border)] p-5 space-y-4 bg-[var(--color-accent-soft)]">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={FIELD_LABEL}>Name *</label>
                    <input
                      type="text"
                      value={editDraft.name}
                      onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                      className={`${INPUT} w-full`}
                      placeholder="e.g. Sales"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className={FIELD_LABEL}>Description</label>
                    <input
                      type="text"
                      value={editDraft.description}
                      onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
                      className={`${INPUT} w-full`}
                      placeholder="Briefly describe this department"
                    />
                  </div>
                </div>

                {/* Reference Fields */}
                <div>
                  <label className={FIELD_LABEL}>{t('ref_fields_label') || 'Reference fields'}</label>
                  <div className="space-y-2">
                    {editDraft.referenceFields.map((field, fIdx) => (
                      <div key={fIdx} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) => updateRefFieldLabel(fIdx, e.target.value)}
                          className={`${INPUT} flex-1`}
                          placeholder={t('ref_field_placeholder') || 'Field label (e.g. Invoice Number)'}
                        />
                        <button
                          type="button"
                          onClick={() => toggleRefFieldOptional(fIdx)}
                          className={`inline-flex items-center px-2.5 h-7 rounded-[var(--radius-pill)] text-[11px] font-medium transition-colors shrink-0 ${
                            field.optional
                              ? 'bg-[var(--color-bg-elevated)] text-[var(--color-ink-muted)]'
                              : 'bg-[var(--color-accent)] text-white'
                          }`}
                          title={field.optional ? t('mark_required') || 'Mark as required' : t('mark_optional') || 'Mark as optional'}
                        >
                          {field.optional ? t('optional') || 'Optional' : t('required_short') || 'Required'}
                        </button>
                        <button
                          onClick={() => removeRefField(fIdx)}
                          className={ICON_BTN}
                          aria-label="Remove field"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={addRefField}
                    disabled={editDraft.referenceFields.length >= 3}
                    className="mt-2 inline-flex items-center gap-1 text-[12px] text-[var(--color-accent)] hover:underline disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
                  >
                    <Plus className="h-3 w-3" aria-hidden />
                    {t('add_ref_field') || 'Add field'}
                    {editDraft.referenceFields.length >= 3 && <span className="ml-2 text-[var(--color-ink-muted)]">({t('max_ref_fields') || 'Maximum 3 fields'})</span>}
                  </button>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-[var(--color-border)]">
                  <button
                    onClick={saveEdit}
                    disabled={isExternal || isSaving}
                    aria-disabled={isExternal || undefined}
                    title={isExternal ? guestTooltip : undefined}
                    data-guest-disabled={isExternal || undefined}
                    className={PRIMARY_BTN}
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    Save
                  </button>
                  <button
                    onClick={cancelEdit}
                    className={SECONDARY_BTN}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              /* View mode */
              <div className={`grid grid-cols-[1fr_1fr_1fr_180px_80px] border-b border-[var(--color-border)] last:border-0 transition-colors ${deletingIdx === idx ? '' : 'hover:bg-[var(--color-hover)]'} group/row`}>
                <div className="px-4 py-3 text-[13px] font-medium text-[var(--color-ink)]">{dept.name}</div>
                <div className="px-4 py-3 text-[13px] text-[var(--color-ink-soft)]">{dept.description || <span className="text-[var(--color-ink-muted)]">—</span>}</div>
                <div className="px-4 py-3 text-[12px] text-[var(--color-ink-soft)]">
                  {dept.referenceFields.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {dept.referenceFields.map((f, i) => (
                        <span key={i} className="inline-flex items-center px-1.5 h-5 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] text-[11px] text-[var(--color-ink)]">
                          {f.label}
                          {f.optional && <span className="ml-1 text-[var(--color-ink-muted)]">?</span>}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[var(--color-ink-muted)]">—</span>
                  )}
                </div>
                <div className="px-4 py-3 text-[12px] text-[var(--color-ink-soft)]">
                  {slaEditingIdx === idx ? (
                    <div className="flex items-center gap-1 flex-wrap">
                      <label className="flex items-center gap-1 text-[11px] text-[var(--color-ink)]">
                        <input
                          type="checkbox"
                          checked={slaDraft.enabled}
                          onChange={(e) => setSlaDraft({ ...slaDraft, enabled: e.target.checked })}
                          className="w-3.5 h-3.5 accent-[var(--color-accent)]"
                        />
                        On
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={480}
                        value={slaDraft.firstResponseMinutes}
                        onChange={(e) => setSlaDraft({ ...slaDraft, firstResponseMinutes: Number(e.target.value) })}
                        className={`${INPUT} w-14 h-7 px-1.5 text-[11px]`}
                        disabled={!slaDraft.enabled}
                      />
                      <span className="text-[11px] text-[var(--color-ink-muted)]">m</span>
                      <select
                        value={slaDraft.warnAtPercent}
                        onChange={(e) => setSlaDraft({ ...slaDraft, warnAtPercent: Number(e.target.value) })}
                        className={`${INPUT} h-7 px-1.5 text-[11px]`}
                        disabled={!slaDraft.enabled}
                      >
                        <option value={50}>50%</option>
                        <option value={75}>75%</option>
                        <option value={90}>90%</option>
                      </select>
                      <button
                        onClick={saveSla}
                        disabled={isExternal || updateSla.isPending}
                        aria-disabled={isExternal || undefined}
                        title={isExternal ? guestTooltip : 'Save'}
                        data-guest-disabled={isExternal || undefined}
                        className="w-6 h-6 inline-flex items-center justify-center rounded-full text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Check className="h-3 w-3" aria-hidden />
                      </button>
                      <button
                        onClick={cancelSlaEdit}
                        className="w-6 h-6 inline-flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
                        title="Cancel"
                      >
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                    </div>
                  ) : dept.sla && dept.sla.enabled ? (
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex items-center px-2 h-6 rounded-[var(--radius-pill)] bg-[var(--color-accent-soft)] text-[11px] font-medium text-[var(--color-accent)] tabular-nums">
                        {dept.sla.firstResponseMinutes}m · {dept.sla.warnAtPercent}%
                      </span>
                      <button
                        onClick={() => startSlaEdit(idx)}
                        disabled={isExternal}
                        aria-disabled={isExternal || undefined}
                        data-guest-disabled={isExternal || undefined}
                        className={`${ICON_BTN} w-6 h-6 opacity-0 group-hover/row:opacity-100`}
                        title={isExternal ? guestTooltip : 'Edit SLA'}
                      >
                        <Pencil className="h-3 w-3" aria-hidden />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-[var(--color-ink-muted)]">Off</span>
                      <button
                        onClick={() => startSlaEdit(idx)}
                        disabled={isExternal}
                        aria-disabled={isExternal || undefined}
                        data-guest-disabled={isExternal || undefined}
                        className="inline-flex items-center px-2 h-6 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[11px] font-medium text-[var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        title={isExternal ? guestTooltip : 'Set SLA'}
                      >
                        Set SLA
                      </button>
                    </div>
                  )}
                </div>
                <div className="px-4 py-3 flex items-center justify-end gap-1">
                  <button
                    onClick={() => startEdit(idx)}
                    disabled={isExternal}
                    aria-disabled={isExternal || undefined}
                    data-guest-disabled={isExternal || undefined}
                    className={`${ICON_BTN} opacity-0 group-hover/row:opacity-100`}
                    title={isExternal ? guestTooltip : 'Edit'}
                    aria-label="Edit department"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    onClick={() => startDelete(idx)}
                    disabled={isExternal}
                    aria-disabled={isExternal || undefined}
                    data-guest-disabled={isExternal || undefined}
                    className={`w-8 h-8 inline-flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[color-mix(in_srgb,var(--color-urgent)_14%,transparent)] hover:text-[var(--color-urgent)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed opacity-0 group-hover/row:opacity-100`}
                    title={isExternal ? guestTooltip : 'Delete'}
                    aria-label="Delete department"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              </div>
            )}

            {/* Delete confirmation — inline banner */}
            {deletingIdx === idx && editingIdx !== idx && (
              <div className="border-b border-[var(--color-border)] px-4 py-3 bg-[color-mix(in_srgb,var(--color-urgent)_8%,transparent)] flex items-center gap-3">
                <Trash2 className="w-4 h-4 text-[var(--color-urgent)] shrink-0" aria-hidden />
                <span className="text-[13px] text-[var(--color-ink)] flex-1">
                  {(memberCounts[dept.id] || 0) > 0
                    ? `${memberCounts[dept.id]} member${memberCounts[dept.id] === 1 ? '' : 's'} will become generalists.`
                    : 'Delete this department?'}
                </span>
                <button
                  onClick={confirmDelete}
                  disabled={isExternal || isSaving}
                  aria-disabled={isExternal || undefined}
                  title={isExternal ? guestTooltip : undefined}
                  data-guest-disabled={isExternal || undefined}
                  className={DANGER_BTN}
                >
                  Confirm delete
                </button>
                <button
                  onClick={() => setDeletingIdx(null)}
                  className={SECONDARY_BTN}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

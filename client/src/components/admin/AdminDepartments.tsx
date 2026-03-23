import { useState, useEffect, useMemo, useRef } from 'react';
import { trpc } from '../../utils/trpc';
import useStore from '../../store/useStore';
import { useT } from '../../i18n';
import { Pencil, Trash2, Check, X, Plus } from 'lucide-react';

interface RefField {
  label: string;
}

interface Department {
  id: string;
  name: string;
  description: string;
  referenceFields: RefField[];
}

function mapDepts(raw: any[] | undefined | null): Department[] {
  return (raw || []).map(d => ({
    id: d.id || '',
    name: d.name || '',
    description: d.description || '',
    referenceFields: d.referenceFields || [],
  }));
}

export default function AdminDepartments() {
  const { memberships, activeMembershipId, setMemberships } = useStore();
  const t = useT();
  const utils = trpc.useUtils();

  // Fetch departments from server — single source of truth
  const { data: manifest } = trpc.partner.getManifest.useQuery();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Department | null>(null);
  const [deletingIdx, setDeletingIdx] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Sync server data → local state (only when not actively editing)
  const isEditing = editingIdx !== null;
  const prevDepsRef = useRef<string>('');
  useEffect(() => {
    if (isEditing || isSaving) return;
    const serverDepts = mapDepts(manifest?.departments as any[]);
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
    (allMembers || []).forEach(m => {
      const deptArr = (m.departments || []) as string[];
      deptArr.forEach(deptId => {
        counts[deptId] = (counts[deptId] || 0) + 1;
      });
    });
    return counts;
  }, [allMembers]);

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
      alert('Failed to update departments: ' + err.message);
    }
  });

  function startEdit(idx: number) {
    setDeletingIdx(null);
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
      alert('Department name is required.');
      return;
    }
    // Check unique labels
    const labels = editDraft.referenceFields.map(f => f.label.trim()).filter(Boolean);
    if (new Set(labels).size !== labels.length) {
      alert('Reference field labels must be unique.');
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
    newFields[fieldIdx] = { label };
    setEditDraft({ ...editDraft, referenceFields: newFields });
  }

  return (
    <div className="max-w-5xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-black uppercase tracking-widest">Departments</h2>
          <p className="text-xs uppercase opacity-60 mt-1">{t('manage_departments') || 'Manage your organization structure'}</p>
        </div>
        <button
          onClick={handleAdd}
          disabled={isSaving}
          className="flex items-center gap-2 px-6 py-2 bg-black dark:bg-white text-white dark:text-black font-black uppercase text-xs tracking-widest disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Department
        </button>
      </div>

      <div className="border-2 border-black dark:border-white">
        {/* Header */}
        <div className="grid grid-cols-[1fr_1fr_1fr_100px_80px] border-b-2 border-black dark:border-white bg-black/5 dark:bg-white/5">
          <div className="px-4 py-3 text-[9px] font-black uppercase tracking-widest opacity-60">Name</div>
          <div className="px-4 py-3 text-[9px] font-black uppercase tracking-widest opacity-60">Description</div>
          <div className="px-4 py-3 text-[9px] font-black uppercase tracking-widest opacity-60">{t('ref_fields_label') || 'Ref Fields'}</div>
          <div className="px-4 py-3 text-[9px] font-black uppercase tracking-widest opacity-60 text-center">Members</div>
          <div className="px-4 py-3 text-[9px] font-black uppercase tracking-widest opacity-60 text-center"></div>
        </div>

        {/* Rows */}
        {departments.map((dept, idx) => (
          <div key={dept.id || `new-${idx}`}>
            {editingIdx === idx && editDraft ? (
              /* Edit mode */
              <div className="border-b border-black/20 dark:border-white/20 p-4 space-y-4 bg-black/[0.02] dark:bg-white/[0.02]">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[9px] font-black uppercase tracking-widest opacity-60 mb-1">Name *</label>
                    <input
                      type="text"
                      value={editDraft.name}
                      onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                      className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm font-bold uppercase"
                      placeholder="e.g. Sales"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-black uppercase tracking-widest opacity-60 mb-1">Description</label>
                    <input
                      type="text"
                      value={editDraft.description}
                      onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
                      className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm"
                      placeholder="Briefly describe this department"
                    />
                  </div>
                </div>

                {/* Reference Fields */}
                <div>
                  <label className="block text-[9px] font-black uppercase tracking-widest opacity-60 mb-2">{t('ref_fields_label') || 'Reference Fields'}</label>
                  <div className="space-y-2">
                    {editDraft.referenceFields.map((field, fIdx) => (
                      <div key={fIdx} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) => updateRefFieldLabel(fIdx, e.target.value)}
                          className="flex-1 border-2 border-black dark:border-white bg-transparent p-2 text-sm"
                          placeholder={t('ref_field_placeholder') || 'Field label (e.g. Invoice Number)'}
                        />
                        <button
                          onClick={() => removeRefField(fIdx)}
                          className="w-8 h-8 flex items-center justify-center border-2 border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={addRefField}
                    disabled={editDraft.referenceFields.length >= 3}
                    className="mt-2 text-[10px] font-black uppercase tracking-widest opacity-60 hover:opacity-100 disabled:opacity-20 disabled:cursor-not-allowed"
                  >
                    + {t('add_ref_field') || 'Add Field'}
                    {editDraft.referenceFields.length >= 3 && <span className="ml-2 normal-case">({t('max_ref_fields') || 'Maximum 3 fields'})</span>}
                  </button>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    onClick={saveEdit}
                    disabled={isSaving}
                    className="flex items-center gap-1.5 px-4 py-2 bg-black dark:bg-white text-white dark:text-black font-black uppercase text-[10px] tracking-widest disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Save
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="flex items-center gap-1.5 px-4 py-2 border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest"
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              /* View mode */
              <div className={`grid grid-cols-[1fr_1fr_1fr_100px_80px] border-b border-black/20 dark:border-white/20 ${deletingIdx === idx ? '' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.02]'}`}>
                <div className="px-4 py-3 font-bold text-sm uppercase">{dept.name}</div>
                <div className="px-4 py-3 text-sm opacity-60">{dept.description || '—'}</div>
                <div className="px-4 py-3 text-xs opacity-60">
                  {dept.referenceFields.length > 0
                    ? dept.referenceFields.map(f => f.label).join(', ')
                    : '—'}
                </div>
                <div className="px-4 py-3 text-sm text-center font-bold">{memberCounts[dept.id] || 0}</div>
                <div className="px-4 py-3 flex items-center justify-center gap-1">
                  <button
                    onClick={() => startEdit(idx)}
                    className="w-7 h-7 flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10"
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => startDelete(idx)}
                    className="w-7 h-7 flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Delete confirmation */}
            {deletingIdx === idx && editingIdx !== idx && (
              <div className="border-b border-black/20 dark:border-white/20 px-4 py-3 bg-black/5 dark:bg-white/5 flex items-center gap-4">
                <span className="text-xs font-black uppercase tracking-widest">
                  {(memberCounts[dept.id] || 0) > 0
                    ? `${memberCounts[dept.id]} member${memberCounts[dept.id] === 1 ? '' : 's'} will become generalists.`
                    : 'Delete this department?'}
                </span>
                <button
                  onClick={confirmDelete}
                  disabled={isSaving}
                  className="px-3 py-1.5 bg-black dark:bg-white text-white dark:text-black font-black uppercase text-[10px] tracking-widest disabled:opacity-50"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setDeletingIdx(null)}
                  className="px-3 py-1.5 border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        ))}

        {departments.length === 0 && (
          <div className="px-4 py-8 text-center text-sm opacity-40 font-black uppercase tracking-widest">
            No departments configured
          </div>
        )}
      </div>
    </div>
  );
}

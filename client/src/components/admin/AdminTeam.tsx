import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useStoreShallow } from '../../store/useStore';
import { useT } from '../../i18n';
import { Pencil, Check, X } from 'lucide-react';
import Toast from '../Toast';

export default function AdminTeam() {
  const t = useT();
  const { activeMembershipId, memberships } = useStoreShallow((s) => ({
    activeMembershipId: s.activeMembershipId,
    memberships: s.memberships,
  }));
  const activeMembership = memberships.find(m => m.id === activeMembershipId);
  const departments = activeMembership?.manifest?.departments || [];

  const [page, setPage] = useState(0);
  const LIMIT = 50;

  const { data, refetch, isLoading } = trpc.partner.listMembers.useQuery(
    { limit: LIMIT, offset: page * LIMIT },
    { enabled: !!activeMembershipId }
  );

  const removeMutation = trpc.partner.removeMember.useMutation({
    onSuccess: () => refetch(),
    onError: (err) => setToast({ message: err.message, type: 'error' })
  });

  const updateMemberMutation = trpc.partner.updateMember.useMutation({
    onSuccess: () => { setEditingMembershipId(null); refetch(); },
    onError: (err) => setToast({ message: err.message, type: 'error' })
  });

  const [showAddModal, setShowAddModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [editingMembershipId, setEditingMembershipId] = useState<string | null>(null);
  const [editDepts, setEditDepts] = useState<string[]>([]);

  return (
    <div className="max-w-7xl surface-card p-6">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-lg font-bold uppercase tracking-wide">Team Members</h2>
          <p className="text-xs uppercase text-[var(--color-text-secondary)] mt-1">Manage users and roles for this partner</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-secondary"
          >
            Add Existing User
          </button>
          <button
            onClick={() => setShowInviteModal(true)}
            className="btn-primary"
          >
            Invite External User
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-8 text-center uppercase font-bold text-[var(--color-text-muted)]">Loading...</div>
      ) : (
        <>
          <div className="border border-[var(--color-border)] mb-4 overflow-x-auto">
            <table className="w-full min-w-[1200px] text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-bg-elevated">
                  <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Name</th>
                  <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Email</th>
                  <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Role</th>
                  <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Status</th>
                  <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Departments</th>
                  <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data?.map((member) => (
                  <tr key={member.membershipId} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                    <td className="p-3 text-sm font-bold uppercase">{member.name}</td>
                    <td className="p-3 text-sm font-mono text-[var(--color-text-secondary)]">{member.email}</td>
                    <td className="p-3 text-sm">
                      <span className="px-2 py-0.5 border border-[var(--color-border)] text-[10px] font-bold uppercase">
                        {member.role}
                      </span>
                    </td>
                    <td className="p-3">
                      {member.externalId || member.lastActiveAt ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 bg-[var(--color-text-primary)]" />
                          <span className="text-[9px] font-bold uppercase tracking-wide">
                            {member.externalId ? t('status_linked_sso') : t('status_active_local')}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
                          <div className="w-1.5 h-1.5 border border-[var(--color-border)]" />
                          <span className="text-[9px] font-bold uppercase tracking-wide">{t('status_pending')}</span>
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-xs uppercase text-[var(--color-text-secondary)]">
                      {member.role === 'agent' ? (
                        <span className="text-[var(--color-text-muted)]">—</span>
                      ) : editingMembershipId === member.membershipId ? (
                        <div className="space-y-1">
                          {departments.map(d => (
                            <label key={d.id} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editDepts.includes(d.id)}
                                onChange={(e) => {
                                  if (e.target.checked) setEditDepts([...editDepts, d.id]);
                                  else setEditDepts(editDepts.filter(id => id !== d.id));
                                }}
                                className="w-3.5 h-3.5"
                              />
                              <span className="text-xs uppercase">{d.name}</span>
                            </label>
                          ))}
                          <p className="text-[9px] text-[var(--color-text-muted)] mt-1">
                            {editDepts.length === 0 ? 'No selection = Generalist (all depts)' : ''}
                          </p>
                          <div className="flex items-center gap-1 pt-1">
                            <button
                              onClick={() => updateMemberMutation.mutate({ membershipId: member.membershipId, departments: editDepts })}
                              disabled={updateMemberMutation.isPending}
                              className="w-6 h-6 flex items-center justify-center border border-[var(--color-border)] hover:bg-[var(--color-accent-blue)] hover:text-white disabled:opacity-50"
                              title="Save"
                            >
                              <Check className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => setEditingMembershipId(null)}
                              className="w-6 h-6 flex items-center justify-center border border-[var(--color-border)] hover:bg-[var(--color-accent-blue)] hover:text-white"
                              title="Cancel"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span
                          className="cursor-pointer hover:underline"
                          onClick={() => {
                            setEditingMembershipId(member.membershipId);
                            setEditDepts((member.departments as string[]) || []);
                          }}
                        >
                          {member.departments && (member.departments as string[]).length > 0
                            ? (member.departments as string[]).map((dId: string) => {
                                const dInfo = departments.find(d => d.id === dId);
                                return dInfo ? dInfo.name : dId;
                              }).join(', ')
                            : <span className="text-[var(--color-text-muted)] italic">All (Generalist)</span>}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {member.role !== 'agent' && (
                          <button
                            onClick={() => {
                              setEditingMembershipId(member.membershipId);
                              setEditDepts((member.departments as string[]) || []);
                            }}
                            className="w-7 h-7 flex items-center justify-center hover:bg-[var(--color-accent-blue)] hover:text-white"
                            title="Edit departments"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (confirm('Remove user from this partner?')) {
                              removeMutation.mutate({ membershipId: member.membershipId });
                            }
                          }}
                          className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-secondary)] hover:line-through"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center text-xs font-bold uppercase">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              className="btn-secondary disabled:opacity-30"
            >
              Previous
            </button>
            <span>Page {page + 1}</span>
            <button
              disabled={(data?.length || 0) < LIMIT}
              onClick={() => setPage(p => p + 1)}
              className="btn-secondary disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </>
      )}

      {showAddModal && <AddExistingUserModal onClose={() => setShowAddModal(false)} onAdded={() => { setShowAddModal(false); refetch(); }} />}
      {showInviteModal && <InviteExternalUserModal onClose={() => setShowInviteModal(false)} onInvited={() => { setShowInviteModal(false); refetch(); }} />}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

function AddExistingUserModal({ onClose, onAdded }: { onClose: () => void, onAdded: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'agent'|'support'>('agent');
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const { activeMembershipId, memberships } = useStoreShallow((s) => ({
    activeMembershipId: s.activeMembershipId,
    memberships: s.memberships,
  }));
  const activeMembership = memberships.find(m => m.id === activeMembershipId);
  const departments = activeMembership?.manifest?.departments || [];

  const addMutation = trpc.partner.addMemberByEmail.useMutation({
    onSuccess: onAdded,
    onError: (err) => setToast({ message: err.message, type: 'error' })
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addMutation.mutate({ email, role, departments: selectedDepts });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black opacity-80" onClick={onClose} aria-label="Close" />
      <div role="dialog" aria-modal="true" className="bg-[var(--color-bg-base)] border border-[var(--color-border)] p-6 w-[480px] relative z-10">
        <h3 className="text-xl font-bold uppercase tracking-tight mb-4">Add Existing User</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mono-label mb-1 block">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="input-field w-full"
            />
          </div>
          <div>
            <label className="mono-label mb-1 block">Role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value as 'agent' | 'support')}
              className="input-field w-full uppercase font-bold"
            >
              <option value="agent">Agent (Creates Tickets)</option>
              <option value="support">Support (Handles Tickets)</option>
            </select>
          </div>
          {role !== 'agent' && departments.length > 0 && (
            <div>
              <label className="mono-label mb-1 block">Departments (Optional)</label>
              <div className="space-y-2 max-h-40 overflow-y-auto border border-[var(--color-border)] p-2">
                {departments.map(d => (
                  <label key={d.id} className="flex items-center gap-2 text-sm uppercase cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedDepts.includes(d.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedDepts([...selectedDepts, d.id]);
                        else setSelectedDepts(selectedDepts.filter(id => id !== d.id));
                      }}
                      className="w-4 h-4"
                    />
                    {d.name}
                  </label>
                ))}
              </div>
              <p className="text-[9px] uppercase text-[var(--color-text-muted)] mt-1">Leave empty to assign to all departments (Generalist).</p>
            </div>
          )}
          <div className="flex gap-4 pt-4">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={addMutation.isPending} className="btn-primary flex-1 disabled:opacity-50">
              {addMutation.isPending ? 'Adding...' : 'Add User'}
            </button>
          </div>
        </form>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </div>
    </div>
  );
}

function InviteExternalUserModal({ onClose, onInvited }: { onClose: () => void, onInvited: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'agent'|'support'>('agent');
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [authMethod, setAuthMethod] = useState<'local' | 'sso'>('local');

  const { activeMembershipId, memberships } = useStoreShallow((s) => ({
    activeMembershipId: s.activeMembershipId,
    memberships: s.memberships,
  }));
  const activeMembership = memberships.find(m => m.id === activeMembershipId);
  const departments = activeMembership?.manifest?.departments || [];
  const partnerAuthMethod = activeMembership?.manifest?.authMethod;

  const inviteMutation = trpc.partner.inviteExternalUser.useMutation({
    onSuccess: (data) => {
      if (data.tempPassword) {
        setTempPassword(data.tempPassword);
      } else {
        onInvited();
      }
    },
    onError: (err) => setToast({ message: err.message, type: 'error' })
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    inviteMutation.mutate({
      email, name, role, departments: selectedDepts,
      ...(partnerAuthMethod === 'both' ? { authMethod } : {}),
    });
  };

  if (tempPassword) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black opacity-80" onClick={() => { setTempPassword(null); onInvited(); }} aria-label="Close" />
        <div role="dialog" aria-modal="true" className="bg-[var(--color-bg-base)] border border-[var(--color-border)] p-6 w-[480px] relative z-10">
          <h3 className="text-xl font-bold uppercase tracking-tight mb-4">User Invited</h3>
          <div className="space-y-4">
            <p className="text-xs font-bold uppercase tracking-wide">User created successfully.</p>
            <div className="border border-[var(--color-border)] p-4">
              <p className="font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Temporary Password</p>
              <div className="flex items-center justify-between gap-3">
                <code className="font-mono text-sm font-bold break-all">{tempPassword}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(tempPassword)}
                  className="btn-secondary shrink-0"
                >
                  Copy
                </button>
              </div>
            </div>
            <p className="text-[9px] uppercase font-bold text-[var(--color-text-muted)]">Share this securely. It won't be shown again.</p>
          </div>
          <div className="flex justify-end mt-6">
            <button
              onClick={() => { setTempPassword(null); onInvited(); }}
              className="btn-primary"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black opacity-80" onClick={onClose} aria-label="Close" />
      <div role="dialog" aria-modal="true" className="bg-[var(--color-bg-base)] border border-[var(--color-border)] p-6 w-[480px] relative z-10">
        <h3 className="text-xl font-bold uppercase tracking-tight mb-4">Invite External User</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mono-label mb-1 block">Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              className="input-field w-full uppercase font-bold"
            />
          </div>
          <div>
            <label className="mono-label mb-1 block">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="input-field w-full"
            />
          </div>
          <div>
            <label className="mono-label mb-1 block">Role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value as 'agent' | 'support')}
              className="input-field w-full uppercase font-bold"
            >
              <option value="agent">Agent (Creates Tickets)</option>
              <option value="support">Support (Handles Tickets)</option>
            </select>
          </div>
          {partnerAuthMethod === 'both' && (
            <div>
              <label className="mono-label mb-1 block">Auth Method</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="inviteAuthMethod" value="local" checked={authMethod === 'local'}
                    onChange={() => setAuthMethod('local')}
                    className="w-4 h-4" />
                  <span className="text-xs font-bold uppercase">Local (Email + Password)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="inviteAuthMethod" value="sso" checked={authMethod === 'sso'}
                    onChange={() => setAuthMethod('sso')}
                    className="w-4 h-4" />
                  <span className="text-xs font-bold uppercase">SSO (Sign in with Microsoft)</span>
                </label>
              </div>
            </div>
          )}
          {role !== 'agent' && departments.length > 0 && (
            <div>
              <label className="mono-label mb-1 block">Departments (Optional)</label>
              <div className="space-y-2 max-h-32 overflow-y-auto border border-[var(--color-border)] p-2">
                {departments.map(d => (
                  <label key={d.id} className="flex items-center gap-2 text-sm uppercase cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedDepts.includes(d.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedDepts([...selectedDepts, d.id]);
                        else setSelectedDepts(selectedDepts.filter(id => id !== d.id));
                      }}
                      className="w-4 h-4"
                    />
                    {d.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-4 pt-4">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={inviteMutation.isPending} className="btn-primary flex-1 disabled:opacity-50">
              {inviteMutation.isPending ? 'Sending...' : 'Generate Invite'}
            </button>
          </div>
        </form>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </div>
    </div>
  );
}

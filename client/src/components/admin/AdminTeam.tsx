import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import useStore, { useStoreShallow } from '../../store/useStore';
import { useT } from '../../i18n';
import { Pencil, Check, X } from 'lucide-react';
import Toast from '../Toast';
import { getStatusColors, getStatusI18nKey } from '../../utils/statusColors';
import { OnlineSupport } from '../../types';

export default function AdminTeam() {
  const t = useT();
  const { activeMembershipId, memberships } = useStoreShallow((s) => ({
    activeMembershipId: s.activeMembershipId,
    memberships: s.memberships,
  }));
  const activeMembership = memberships.find(m => m.id === activeMembershipId);
  const departments = activeMembership?.manifest?.departments || [];

  const onlineSupportUsers = useStore((s) => s.onlineSupportUsers) as OnlineSupport[];
  const onlineStatusMap = new Map(onlineSupportUsers.map((u) => [u.userId, u.status]));

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const LIMIT = 20;

  const { data, refetch, isLoading } = trpc.partner.listMembers.useQuery(
    { limit: LIMIT, offset: page * LIMIT, search: search.trim() || undefined },
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
    <div className="flex flex-col min-h-full">
      <div className="flex flex-col sm:flex-row justify-between items-end sm:items-center gap-4 mb-6 border-b border-border pb-6">
        <div>
          <h2 className="text-3xl font-bold uppercase tracking-tighter">Team</h2>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-secondary)] mt-1 opacity-60">Manage users and roles</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Filter members..."
              className="w-full bg-bg-elevated border-2 border-border-heavy px-3 py-2 text-xs font-bold uppercase placeholder:opacity-30 focus:border-accent-blue outline-none pr-8"
            />
            {search && (
              <button 
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary p-1"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="h-8 w-px bg-border mx-1 hidden sm:block" />
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 text-[10px] font-bold uppercase border-2 border-border-heavy hover:bg-bg-elevated transition-all"
          >
            Add Existing
          </button>
          <button
            onClick={() => setShowInviteModal(true)}
            className="px-4 py-2 text-[10px] font-bold uppercase bg-accent-blue text-white hover:bg-accent-blue/80 transition-all"
          >
            Invite External
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center py-20 opacity-30">
          <div className="animate-spin h-6 w-6 border-2 border-current border-t-transparent mb-4" />
          <p className="text-[10px] font-bold uppercase tracking-widest">Loading Team...</p>
        </div>
      ) : (
        <div className="bg-bg-surface border-2 border-border-heavy overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-border-heavy bg-bg-elevated text-left font-mono text-[9px] uppercase text-[var(--color-text-muted)]">
                  <th className="px-4 py-2.5 font-bold tracking-widest">User / Identity</th>
                  <th className="px-4 py-2.5 font-bold tracking-widest">Role</th>
                  <th className="px-4 py-2.5 font-bold tracking-widest text-center">App</th>
                  <th className="px-4 py-2.5 font-bold tracking-widest text-center">Auth</th>
                  <th className="px-4 py-2.5 font-bold tracking-widest">Departments / Access</th>
                  <th className="px-4 py-2.5 font-bold tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {data?.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-20 text-center opacity-30">
                      <p className="text-[10px] font-bold uppercase tracking-widest">No matching users found.</p>
                    </td>
                  </tr>
                ) : data?.map((member) => (
                  <tr key={member.membershipId} className="hover:bg-bg-elevated/50 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col min-w-[200px]">
                        <span className="font-bold uppercase tracking-tight text-[13px]">{member.name}</span>
                        <span className="text-[10px] font-mono opacity-40">{member.email}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="px-1.5 py-0.5 border border-border bg-bg-elevated text-[9px] font-bold uppercase tracking-widest">
                        {member.role}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {(() => {
                        const onlineStatus = onlineStatusMap.get(member.userId);
                        const colors = getStatusColors(onlineStatus);
                        const label = onlineStatus ? t(getStatusI18nKey(onlineStatus)) : t('status_offline');
                        return (
                          <span className="inline-flex items-center gap-1.5 justify-center" title={label}>
                            <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                            <span className={`text-[9px] font-bold uppercase tracking-tighter ${colors.text}`}>{label}</span>
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {member.externalId || member.lastActiveAt ? (
                        <div className="flex items-center gap-1.5 justify-center">
                          <div className="w-1 h-1 bg-[var(--color-text-primary)]" />
                          <span className="text-[9px] font-bold uppercase tracking-widest opacity-60">
                            {member.externalId ? 'SSO' : 'Local'}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-[var(--color-text-muted)] justify-center">
                          <div className="w-1 h-1 border border-[var(--color-border)] opacity-30" />
                          <span className="text-[9px] font-bold uppercase tracking-widest opacity-20">Pending</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {member.role === 'agent' ? (
                        <span className="text-[9px] font-bold uppercase opacity-10 tracking-widest">Global Agent</span>
                      ) : editingMembershipId === member.membershipId ? (
                        <div className="space-y-1 bg-bg-elevated p-2 border border-border-heavy min-w-[180px]">
                          {departments.map(d => (
                            <label key={d.id} className="flex items-center gap-2 cursor-pointer py-0.5">
                              <input
                                type="checkbox"
                                checked={editDepts.includes(d.id)}
                                onChange={(e) => {
                                  if (e.target.checked) setEditDepts([...editDepts, d.id]);
                                  else setEditDepts(editDepts.filter(id => id !== d.id));
                                }}
                                className="w-3 h-3 accent-accent-blue"
                              />
                              <span className="text-[9px] font-bold uppercase tracking-tighter">{d.name}</span>
                            </label>
                          ))}
                          <div className="flex items-center gap-1 pt-2 border-t border-border mt-1">
                            <button
                              onClick={() => updateMemberMutation.mutate({ membershipId: member.membershipId, departments: editDepts })}
                              disabled={updateMemberMutation.isPending}
                              className="flex-1 py-1 text-[8px] font-bold bg-accent-blue text-white uppercase disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingMembershipId(null)}
                              className="px-2 py-1 text-[8px] font-bold border border-border uppercase"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          className="cursor-pointer group flex flex-wrap gap-1 items-center min-h-[24px]"
                          onClick={() => {
                            setEditingMembershipId(member.membershipId);
                            setEditDepts((member.departments as string[]) || []);
                          }}
                        >
                          {member.departments && (member.departments as string[]).length > 0
                            ? (member.departments as string[]).map((dId: string) => {
                                const dInfo = departments.find(d => d.id === dId);
                                return (
                                  <span key={dId} className="text-[8px] font-bold border border-border px-1.5 py-0.5 bg-bg-elevated uppercase tracking-tighter">
                                    {dInfo ? dInfo.name : dId}
                                  </span>
                                );
                              })
                            : <span className="text-[9px] font-bold uppercase tracking-widest opacity-30 italic">Generalist (All Depts)</span>}
                          <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity ml-1 text-accent-blue" />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => {
                          if (confirm('Remove user from this partner?')) {
                            removeMutation.mutate({ membershipId: member.membershipId });
                          }
                        }}
                        className="text-[9px] font-bold uppercase tracking-widest text-[var(--color-text-secondary)] hover:text-red-500 hover:line-through transition-colors"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          <div className="px-4 py-2.5 border-t-2 border-border-heavy flex items-center justify-between bg-bg-elevated/30">
            <span className="text-[9px] font-bold uppercase tracking-widest opacity-40">
              {data?.length || 0} users showing (Max {LIMIT} per page)
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest border-2 border-border-heavy hover:bg-bg-elevated transition-all disabled:opacity-20"
              >
                Prev
              </button>
              <button
                disabled={(data?.length || 0) < LIMIT}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest border-2 border-border-heavy hover:bg-bg-elevated transition-all disabled:opacity-20"
              >
                Next
              </button>
            </div>
          </div>
        </div>
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

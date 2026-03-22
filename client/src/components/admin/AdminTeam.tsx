import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import useStore from '../../store/useStore';

export default function AdminTeam() {
  const { activeMembershipId, memberships } = useStore();
  const activeMembership = memberships.find(m => m.id === activeMembershipId);
  const departments = activeMembership?.manifest?.departments || [];

  const [page, setPage] = useState(0);
  const LIMIT = 20;

  const { data, refetch, isLoading } = trpc.partner.listMembers.useQuery(
    { limit: LIMIT, offset: page * LIMIT },
    { enabled: !!activeMembershipId }
  );

  const removeMutation = trpc.partner.removeMember.useMutation({
    onSuccess: () => refetch(),
    onError: (err) => alert(err.message)
  });

  const [showAddModal, setShowAddModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);

  return (
    <div className="min-w-[1180px] max-w-6xl border-2 border-black dark:border-white p-6">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-lg font-black uppercase tracking-widest">Team Members</h2>
          <p className="text-xs uppercase opacity-60 mt-1">Manage users and roles for this partner</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 border-2 border-black dark:border-white font-black uppercase text-xs tracking-widest hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black transition-all"
          >
            Add Existing User
          </button>
          <button 
            onClick={() => setShowInviteModal(true)}
            className="px-4 py-2 bg-black text-white dark:bg-white dark:text-black font-black uppercase text-xs tracking-widest hover:invert transition-all"
          >
            Invite External User
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-8 text-center uppercase font-black opacity-50">Loading...</div>
      ) : (
        <>
          <div className="border border-black dark:border-white mb-4 overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left border-collapse">
              <thead>
                <tr className="border-b-2 border-black dark:border-white bg-black/5 dark:bg-white/5">
                  <th className="p-3 text-[10px] font-black uppercase tracking-widest">Name</th>
                  <th className="p-3 text-[10px] font-black uppercase tracking-widest">Email</th>
                  <th className="p-3 text-[10px] font-black uppercase tracking-widest">Role</th>
                  <th className="p-3 text-[10px] font-black uppercase tracking-widest">Departments</th>
                  <th className="p-3 text-[10px] font-black uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/20 dark:divide-white/20">
                {data?.map((member) => (
                  <tr key={member.membershipId} className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                    <td className="p-3 text-sm font-bold uppercase">{member.name}</td>
                    <td className="p-3 text-sm font-mono opacity-80">{member.email}</td>
                    <td className="p-3 text-sm">
                      <span className="px-2 py-0.5 border border-current text-[10px] font-black uppercase">
                        {member.role}
                      </span>
                    </td>
                    <td className="p-3 text-xs uppercase opacity-80">
                      {member.departments && (member.departments as string[]).length > 0
                        ? (member.departments as string[]).map((dId: string) => {
                            const dInfo = departments.find(d => d.id === dId);
                            return dInfo ? dInfo.name : dId;
                          }).join(', ')
                        : <span className="opacity-50 italic">All (Generalist)</span>}
                    </td>
                    <td className="p-3 text-right">
                      <button 
                        onClick={() => {
                          if (confirm('Remove user from this partner?')) {
                            removeMutation.mutate({ membershipId: member.membershipId });
                          }
                        }}
                        className="text-[10px] font-black uppercase tracking-widest text-red-600 hover:line-through"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center text-xs font-black uppercase">
            <button 
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              className="px-4 py-2 border border-black dark:border-white disabled:opacity-30"
            >
              Previous
            </button>
            <span>Page {page + 1}</span>
            <button 
              disabled={(data?.length || 0) < LIMIT}
              onClick={() => setPage(p => p + 1)}
              className="px-4 py-2 border border-black dark:border-white disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </>
      )}

      {showAddModal && <AddExistingUserModal onClose={() => setShowAddModal(false)} onAdded={() => { setShowAddModal(false); refetch(); }} />}
      {showInviteModal && <InviteExternalUserModal onClose={() => setShowInviteModal(false)} onInvited={() => { setShowInviteModal(false); refetch(); }} />}
    </div>
  );
}

function AddExistingUserModal({ onClose, onAdded }: { onClose: () => void, onAdded: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'agent'|'support'>('agent');
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  
  const { activeMembershipId, memberships } = useStore();
  const activeMembership = memberships.find(m => m.id === activeMembershipId);
  const departments = activeMembership?.manifest?.departments || [];

  const addMutation = trpc.partner.addMemberByEmail.useMutation({
    onSuccess: onAdded,
    onError: (err) => alert(err.message)
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addMutation.mutate({ email, role, departments: selectedDepts });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black opacity-80" onClick={onClose} />
      <div className="bg-white dark:bg-black border-2 border-black dark:border-white p-6 w-[480px] relative z-10">
        <h3 className="text-xl font-black uppercase tracking-tighter mb-4">Add Existing User</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1">Email</label>
            <input 
              type="email" 
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1">Role</label>
            <select 
              value={role}
              onChange={e => setRole(e.target.value as any)}
              className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm uppercase font-bold"
            >
              <option value="agent">Agent (Creates Tickets)</option>
              <option value="support">Support (Handles Tickets)</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1">Departments (Optional)</label>
            <div className="space-y-2 max-h-40 overflow-y-auto border border-black/20 dark:border-white/20 p-2">
              {departments.map(d => (
                <label key={d.id} className="flex items-center gap-2 text-sm uppercase cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={selectedDepts.includes(d.id)}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedDepts([...selectedDepts, d.id]);
                      else setSelectedDepts(selectedDepts.filter(id => id !== d.id));
                    }}
                    className="accent-black dark:accent-white w-4 h-4"
                  />
                  {d.name}
                </label>
              ))}
            </div>
            <p className="text-[9px] uppercase opacity-50 mt-1">Leave empty to assign to all departments (Generalist).</p>
          </div>
          <div className="flex gap-4 pt-4">
            <button type="button" onClick={onClose} className="flex-1 py-3 border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest hover:bg-black/5">Cancel</button>
            <button type="submit" disabled={addMutation.isPending} className="flex-1 py-3 bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest hover:invert">
              {addMutation.isPending ? 'Adding...' : 'Add User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InviteExternalUserModal({ onClose, onInvited }: { onClose: () => void, onInvited: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'agent'|'support'>('agent');
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  
  const { activeMembershipId, memberships } = useStore();
  const activeMembership = memberships.find(m => m.id === activeMembershipId);
  const departments = activeMembership?.manifest?.departments || [];

  const inviteMutation = trpc.partner.inviteExternalUser.useMutation({
    onSuccess: (data) => {
      if (data.tempPassword) {
        setTempPassword(data.tempPassword);
      } else {
        onInvited();
      }
    },
    onError: (err) => alert(err.message)
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    inviteMutation.mutate({ email, name, role, departments: selectedDepts });
  };

  if (tempPassword) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black opacity-80" onClick={() => { setTempPassword(null); onInvited(); }} />
        <div className="bg-white dark:bg-black border-2 border-black dark:border-white p-6 w-[480px] relative z-10">
          <h3 className="text-xl font-black uppercase tracking-tighter mb-4">User Invited</h3>
          <div className="space-y-4">
            <p className="text-xs font-bold uppercase tracking-widest">User created successfully.</p>
            <div className="border-2 border-black dark:border-white p-4">
              <p className="text-[10px] font-black uppercase tracking-widest mb-2 opacity-60">Temporary Password</p>
              <div className="flex items-center justify-between gap-3">
                <code className="font-mono text-sm font-bold break-all">{tempPassword}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(tempPassword)}
                  className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black shrink-0"
                >
                  Copy
                </button>
              </div>
            </div>
            <p className="text-[9px] uppercase font-bold opacity-50">Share this securely. It won't be shown again.</p>
          </div>
          <div className="flex justify-end mt-6">
            <button
              onClick={() => { setTempPassword(null); onInvited(); }}
              className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white"
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
      <div className="absolute inset-0 bg-black opacity-80" onClick={onClose} />
      <div className="bg-white dark:bg-black border-2 border-black dark:border-white p-6 w-[480px] relative z-10">
        <h3 className="text-xl font-black uppercase tracking-tighter mb-4">Invite External User</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1">Name</label>
            <input 
              type="text" 
              required
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm uppercase font-bold"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1">Email</label>
            <input 
              type="email" 
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1">Role</label>
            <select 
              value={role}
              onChange={e => setRole(e.target.value as any)}
              className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm uppercase font-bold"
            >
              <option value="agent">Agent (Creates Tickets)</option>
              <option value="support">Support (Handles Tickets)</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1">Departments (Optional)</label>
            <div className="space-y-2 max-h-32 overflow-y-auto border border-black/20 dark:border-white/20 p-2">
              {departments.map(d => (
                <label key={d.id} className="flex items-center gap-2 text-sm uppercase cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={selectedDepts.includes(d.id)}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedDepts([...selectedDepts, d.id]);
                      else setSelectedDepts(selectedDepts.filter(id => id !== d.id));
                    }}
                    className="accent-black dark:accent-white w-4 h-4"
                  />
                  {d.name}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-4 pt-4">
            <button type="button" onClick={onClose} className="flex-1 py-3 border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest hover:bg-black/5">Cancel</button>
            <button type="submit" disabled={inviteMutation.isPending} className="flex-1 py-3 bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest hover:invert">
              {inviteMutation.isPending ? 'Sending...' : 'Generate Invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

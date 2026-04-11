import { useState, useMemo } from 'react';
import { trpc } from '../../utils/trpc';
import useStore, { useStoreShallow } from '../../store/useStore';
import { useT } from '../../i18n';
import { Pencil, Check, X, Search, Users, Shield, User, UserX } from 'lucide-react';
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
  const [roleFilter, setRoleFilter] = useState<'agent' | 'support' | ''>('');
  const [unconfiguredOnly, setUnconfiguredOnly] = useState(false);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const LIMIT = 20;

  const { data, refetch, isLoading } = trpc.partner.listMembers.useQuery(
    {
      limit: LIMIT,
      offset: page * LIMIT,
      search: search.trim() || undefined,
      role: roleFilter || undefined,
      excludeAdmin: true,
    },
    { enabled: !!activeMembershipId }
  );

  // Data comes pre-filtered from server (admins excluded, role filter applied)
  const filteredData = data ?? [];

  // Summary counts — uses full unfiltered (but admin-excluded) query for card stats
  const { data: allData } = trpc.partner.listMembers.useQuery(
    { limit: 100, offset: 0, excludeAdmin: true },
    { enabled: !!activeMembershipId }
  );
  const stats = useMemo(() => {
    const all = allData ?? [];
    if (!all.length) return { total: 0, agents: 0, support: 0, unconfigured: 0, online: 0 };
    return {
      total: all.length,
      agents: all.filter(m => m.role === 'agent').length,
      support: all.filter(m => m.role === 'support').length,
      unconfigured: all.filter(m => !m.departments || !Array.isArray(m.departments) || m.departments.length === 0).length,
      online: all.filter(m => onlineStatusMap.has(m.userId)).length,
    };
  }, [allData, onlineStatusMap]);

  const displayData = useMemo(() => {
    let result = filteredData;
    if (onlineOnly) {
      result = result.filter(m => onlineStatusMap.has(m.userId));
    }
    if (unconfiguredOnly) {
      result = result.filter(m => !m.departments || !Array.isArray(m.departments) || m.departments.length === 0);
    }
    return result;
  }, [filteredData, onlineOnly, unconfiguredOnly, onlineStatusMap]);

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

  const handleRoleFilter = (role: '' | 'agent' | 'support') => {
    setRoleFilter(role);
    setOnlineOnly(false);
    setUnconfiguredOnly(false);
    setPage(0);
  };

  const handleOnlineFilter = () => {
    setRoleFilter('');
    setOnlineOnly(!onlineOnly);
    setUnconfiguredOnly(false);
    setPage(0);
  };

  const handleUnconfiguredFilter = () => {
    setRoleFilter('');
    setOnlineOnly(false);
    setUnconfiguredOnly(!unconfiguredOnly);
    setPage(0);
  };

  return (
    <div className="flex flex-col min-h-full space-y-6">
      {/* Header & Main Controls */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 border-b-2 border-border-heavy pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Users className="h-6 w-6 text-accent-blue" />
            <h2 className="text-3xl font-bold uppercase tracking-tighter">Team Management</h2>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-secondary)] opacity-60">
            Define roles and departmental access for your organization.
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
          <div className="relative group min-w-[280px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted group-focus-within:text-accent-blue transition-colors" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Filter by name, role, or department..."
              className="w-full bg-bg-surface border-2 border-border px-9 py-2.5 text-xs font-bold uppercase placeholder:opacity-30 focus:border-accent-blue outline-none transition-all"
            />
            {search && (
              <button 
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-accent-red p-1 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowInviteModal(true)}
              className="flex-1 sm:flex-none px-4 py-2.5 text-[10px] font-bold uppercase bg-accent-blue text-[var(--color-btn-text-inverse)] border-2 border-accent-blue hover:bg-accent-blue/90 active:scale-[0.98] transition-all shadow-[4px_4px_0px_0px_rgba(59,130,246,0.2)] whitespace-nowrap"
            >
              Invite External
            </button>
          </div>
        </div>
      </div>

      {/* Stats Bar — each card doubles as a filter */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { label: 'All Members', value: stats.total, icon: Users, handler: () => handleRoleFilter(''), active: !roleFilter && !onlineOnly && !unconfiguredOnly },
          { label: 'Support Staff', value: stats.support, icon: Shield, handler: () => handleRoleFilter('support'), active: roleFilter === 'support', color: 'text-accent-purple' },
          { label: 'Agents', value: stats.agents, icon: User, handler: () => handleRoleFilter('agent'), active: roleFilter === 'agent', color: 'text-accent-blue' },
          { label: 'Unconfigured', value: stats.unconfigured, icon: UserX, handler: handleUnconfiguredFilter, active: unconfiguredOnly, color: 'text-accent-amber' },
          { label: 'Currently Online', value: stats.online, icon: Check, handler: handleOnlineFilter, active: onlineOnly, color: 'text-accent-green' },
        ].map((stat) => (
          <button
            key={stat.label}
            onClick={stat.handler}
            className={`flex flex-col p-4 bg-bg-surface border ${stat.active ? 'border-accent-blue bg-accent-blue/5' : 'border-border'} hover:border-accent-blue group transition-all text-left relative overflow-hidden`}
          >
            <div className="flex justify-between items-start mb-2 relative z-10">
              <span className="text-[9px] font-bold uppercase tracking-widest text-text-muted group-hover:text-text-primary transition-colors">{stat.label}</span>
              <stat.icon className={`h-4 w-4 ${stat.color || 'text-text-muted'} opacity-40 group-hover:opacity-100 transition-all`} />
            </div>
            <span className="text-2xl font-bold font-mono tracking-tighter relative z-10">{stat.value}</span>
            <div className="absolute bottom-0 left-0 h-0.5 w-0 group-hover:w-full bg-accent-blue transition-all duration-300" />
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center py-32 border-2 border-dashed border-border opacity-30">
          <div className="animate-spin h-8 w-8 border-2 border-accent-blue border-t-transparent mb-4" />
          <p className="text-[10px] font-bold uppercase tracking-widest font-mono">Querying directory...</p>
        </div>
      ) : (
        <div className="bg-bg-surface border-2 border-border-heavy overflow-hidden shadow-[8px_8px_0px_0px_rgba(0,0,0,0.1)]">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-border-heavy bg-bg-elevated text-left font-mono text-[9px] uppercase text-[var(--color-text-muted)]">
                  <th className="px-6 py-4 font-bold tracking-widest">Identity</th>
                  <th className="px-6 py-4 font-bold tracking-widest">Permission Level</th>
                  <th className="px-6 py-4 font-bold tracking-widest text-center">Status</th>
                  <th className="px-6 py-4 font-bold tracking-widest">Department Access</th>
                  <th className="px-6 py-4 font-bold tracking-widest text-right">Control</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {displayData.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-24 text-center">
                      <div className="flex flex-col items-center opacity-30">
                        <Search className="h-8 w-8 mb-4" />
                        <p className="text-[10px] font-bold uppercase tracking-widest">No match detected for "{search}"</p>
                        <button 
                          onClick={() => setSearch('')}
                          className="mt-4 text-[9px] underline underline-offset-4 hover:text-accent-blue"
                        >
                          Reset Filter
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : displayData.map((member) => (
                  <tr key={member.membershipId} className="hover:bg-bg-elevated/40 transition-colors group/row">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full border-2 border-border-heavy flex items-center justify-center font-bold text-[10px] uppercase bg-bg-elevated">
                          {member.name?.slice(0, 2)}
                        </div>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-bold uppercase tracking-tight text-[13px] group-hover/row:text-accent-blue transition-colors">{member.name}</span>
                            {member.externalId ? (
                              <span className="text-[7px] bg-accent-blue/10 text-accent-blue border border-accent-blue/20 px-1 font-mono font-bold tracking-tighter">SSO SYNC</span>
                            ) : member.lastActiveAt && (
                              <span className="text-[7px] border border-border px-1 font-mono opacity-40">LOCAL</span>
                            )}
                          </div>
                          <div className="flex flex-col gap-0.5 mt-0.5">
                            <span className="text-[10px] font-mono opacity-40">{member.email}</span>
                            <div className="flex items-center gap-2">
                              {!member.externalId && !member.lastActiveAt ? (
                                <span className="text-[7px] font-bold uppercase text-accent-purple animate-pulse tracking-tighter">[INVITE PENDING]</span>
                              ) : member.lastActiveAt && (
                                <span className="text-[7px] font-mono opacity-30 uppercase tracking-tighter">
                                  Last Activity: {new Date(member.lastActiveAt).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <User className="h-3 w-3 text-text-muted" />
                        <span className="px-2 py-0.5 border text-[9px] font-bold uppercase tracking-widest border-border bg-bg-elevated">
                          {member.role}
                        </span>
                        {member.source === 'manual' && (
                          <span className="text-[7px] border border-accent-amber/30 text-accent-amber px-1 font-mono font-bold tracking-tighter">MANUAL</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {(() => {
                        const onlineStatus = onlineStatusMap.get(member.userId);
                        const colors = getStatusColors(onlineStatus);
                        const label = onlineStatus ? t(getStatusI18nKey(onlineStatus)) : t('status_offline');
                        return (
                          <div className="inline-flex flex-col items-center gap-1" title={label}>
                            <div className={`w-2 h-2 rounded-full border border-black/20 ${colors.dot} ${onlineStatus ? 'animate-pulse' : ''}`} />
                            <span className={`text-[8px] font-bold uppercase tracking-tighter ${colors.text}`}>{label}</span>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4">
                      {member.role === 'agent' ? (
                        <div className="flex items-center gap-2 text-text-muted opacity-30 group-hover/row:opacity-100 transition-opacity">
                          <span className="text-[9px] font-bold uppercase tracking-widest italic">Selects per ticket</span>
                        </div>
                      ) : editingMembershipId === member.membershipId ? (
                        <div className="space-y-2 bg-bg-surface p-3 border-2 border-accent-blue shadow-[4px_4px_0px_0px_rgba(59,130,246,0.1)] min-w-[200px]">
                          <div className="max-h-40 overflow-y-auto pr-2 space-y-1 custom-scrollbar">
                            {departments.map(d => (
                              <label key={d.id} className="flex items-center gap-2 cursor-pointer py-1 px-2 hover:bg-bg-elevated transition-colors border border-transparent hover:border-border">
                                <input
                                  type="checkbox"
                                  checked={editDepts.includes(d.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) setEditDepts([...editDepts, d.id]);
                                    else setEditDepts(editDepts.filter(id => id !== d.id));
                                  }}
                                  className="w-3.5 h-3.5 accent-accent-blue"
                                />
                                <span className="text-[10px] font-bold uppercase tracking-tighter">{d.name}</span>
                              </label>
                            ))}
                          </div>
                          {member.role === 'support' && editDepts.length === 0 && (
                            <p className="text-[8px] font-bold uppercase text-accent-red tracking-widest">Support requires at least one department</p>
                          )}
                          <div className="flex items-center gap-2 pt-2 border-t border-border mt-2">
                            <button
                              onClick={() => updateMemberMutation.mutate({ membershipId: member.membershipId, departments: editDepts })}
                              disabled={updateMemberMutation.isPending || (member.role === 'support' && editDepts.length === 0)}
                              className="flex-1 py-1.5 text-[9px] font-bold bg-accent-blue text-[var(--color-btn-text-inverse)] uppercase border border-accent-blue hover:bg-accent-blue/90 disabled:opacity-50 transition-all"
                            >
                              {updateMemberMutation.isPending ? '...' : 'Save'}
                            </button>
                            <button
                              onClick={() => setEditingMembershipId(null)}
                              className="flex-1 py-1.5 text-[9px] font-bold border-2 border-border-heavy uppercase hover:bg-bg-elevated transition-all"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          className="cursor-pointer group/dept flex flex-wrap gap-1.5 items-center min-h-[32px] p-1 -m-1 hover:bg-bg-elevated/50 transition-colors border border-transparent hover:border-border"
                          onClick={() => {
                            setEditingMembershipId(member.membershipId);
                            setEditDepts((member.departments as string[]) || []);
                          }}
                        >
                          {member.departments && (member.departments as string[]).length > 0
                            ? (member.departments as string[]).map((dId: string) => {
                                const dInfo = departments.find(d => d.id === dId);
                                return (
                                  <span key={dId} className="text-[9px] font-bold border-2 border-border px-2 py-0.5 bg-bg-surface uppercase tracking-tighter group-hover/dept:border-accent-blue transition-colors">
                                    {dInfo ? dInfo.name : dId}
                                  </span>
                                );
                              })
                            : <span className="text-[10px] font-bold uppercase tracking-widest opacity-20 italic group-hover/dept:opacity-100 transition-opacity">No departments assigned</span>}
                          <Pencil className="h-3 w-3 opacity-0 group-hover/row:opacity-100 transition-opacity ml-auto text-accent-blue" />
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => {
                          if (confirm(`Remove ${member.name} from this partner?`)) {
                            removeMutation.mutate({ membershipId: member.membershipId });
                          }
                        }}
                        className="p-2 text-[9px] font-bold uppercase tracking-widest text-text-muted hover:text-accent-red hover:bg-accent-red/5 transition-all opacity-40 hover:opacity-100"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          <div className="px-6 py-4 border-t-2 border-border-heavy flex flex-col sm:flex-row items-center justify-between gap-4 bg-bg-elevated/20">
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                Showing <span className="text-text-primary">{displayData.length}</span> identities
              </span>
              <div className="h-4 w-px bg-border hidden sm:block" />
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold uppercase tracking-tighter opacity-40">Limit:</span>
                <span className="px-2 py-0.5 bg-bg-elevated text-[9px] font-mono font-bold border border-border">{LIMIT}</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                className="px-6 py-2 text-[10px] font-bold uppercase tracking-widest border-2 border-border-heavy hover:bg-bg-elevated active:scale-95 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                disabled={displayData.length < LIMIT}
                onClick={() => setPage(p => p + 1)}
                className="px-6 py-2 text-[10px] font-bold uppercase tracking-widest bg-border-heavy text-white hover:bg-black active:scale-95 transition-all disabled:opacity-20 disabled:cursor-not-allowed shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)]"
              >
                Next Page
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

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    addMutation.mutate({ email, role, departments: selectedDepts });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} aria-label="Close" />
      <div role="dialog" aria-modal="true" className="bg-[var(--color-bg-base)] border-2 border-border-heavy p-8 w-full max-w-[480px] relative z-10 shadow-[12px_12px_0px_0px_rgba(0,0,0,0.2)]">
        <h3 className="text-2xl font-bold uppercase tracking-tighter mb-6 flex items-center gap-3">
          <Users className="h-6 w-6 text-accent-blue" />
          Add Existing User
        </h3>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Direct Email Identification</label>
            <input
              type="email"
              required
              placeholder="USER@EXAMPLE.COM"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-bg-surface border-2 border-border px-4 py-3 text-sm focus:border-accent-blue outline-none transition-all uppercase font-mono"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Operational Role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value as 'agent' | 'support')}
              className="w-full bg-bg-surface border-2 border-border px-4 py-3 text-sm font-bold uppercase tracking-widest focus:border-accent-blue outline-none transition-all"
            >
              <option value="agent">Agent (Generates Tickets)</option>
              <option value="support">Support (Processes Tickets)</option>
            </select>
          </div>
          {role !== 'agent' && departments.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Departmental Assignments</label>
                <button
                  type="button"
                  onClick={() => setSelectedDepts(selectedDepts.length === departments.length ? [] : departments.map(d => d.id))}
                  className="text-[8px] font-bold uppercase tracking-widest text-accent-blue hover:underline"
                >
                  {selectedDepts.length === departments.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto border-2 border-border p-3 bg-bg-elevated/30">
                {departments.map(d => (
                  <label key={d.id} className="flex items-center gap-3 text-xs font-bold uppercase cursor-pointer hover:text-accent-blue transition-colors py-1">
                    <input
                      type="checkbox"
                      checked={selectedDepts.includes(d.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedDepts([...selectedDepts, d.id]);
                        else setSelectedDepts(selectedDepts.filter(id => id !== d.id));
                      }}
                      className="w-4 h-4 accent-accent-blue"
                    />
                    {d.name}
                  </label>
                ))}
              </div>
              {role === 'support' && selectedDepts.length === 0 && (
                <p className="text-[8px] font-bold uppercase text-accent-red tracking-widest">Support requires at least one department</p>
              )}
            </div>
          )}
          <div className="flex gap-4 pt-4">
            <button type="button" onClick={onClose} className="flex-1 py-3 text-[11px] font-bold uppercase border-2 border-border-heavy hover:bg-bg-elevated transition-all">Cancel</button>
            <button type="submit" disabled={addMutation.isPending || (role === 'support' && selectedDepts.length === 0)} className="flex-1 py-3 text-[11px] font-bold uppercase bg-accent-blue text-[var(--color-btn-text-inverse)] hover:bg-accent-blue/90 disabled:opacity-50 transition-all">
              {addMutation.isPending ? 'Processing...' : 'Verify & Add'}
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

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    inviteMutation.mutate({
      email, name, role, departments: selectedDepts,
      ...(partnerAuthMethod === 'both' ? { authMethod } : {}),
    });
  };

  if (tempPassword) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => { setTempPassword(null); onInvited(); }} aria-label="Close" />
        <div role="dialog" aria-modal="true" className="bg-[var(--color-bg-base)] border-2 border-border-heavy p-8 w-full max-w-[480px] relative z-10 shadow-[12px_12px_0px_0px_rgba(0,0,0,0.2)]">
          <h3 className="text-2xl font-bold uppercase tracking-tighter mb-4 flex items-center gap-3">
            <Check className="h-6 w-6 text-accent-green" />
            Invitation Generated
          </h3>
          <div className="space-y-6">
            <p className="text-sm font-bold uppercase tracking-tight opacity-70">New identity record created. Provision the temporary credentials below:</p>
            <div className="border-2 border-border bg-bg-surface p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-8 h-8 bg-accent-blue/10 transform rotate-45 translate-x-4 -translate-y-4" />
              <p className="font-mono text-[9px] uppercase tracking-widest text-text-muted mb-3 italic">One-Time Credentials</p>
              <div className="flex items-center justify-between gap-4">
                <code className="font-mono text-base font-bold break-all text-accent-blue select-all bg-bg-elevated px-2 py-1">{tempPassword}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(tempPassword)}
                  className="px-4 py-2 text-[10px] font-bold uppercase border-2 border-border-heavy hover:bg-bg-elevated active:scale-95 transition-all"
                >
                  Copy
                </button>
              </div>
            </div>
            <p className="text-[9px] uppercase font-bold text-accent-red tracking-widest animate-pulse">Critical: This sequence will not be displayed again. Secure it immediately.</p>
          </div>
          <div className="flex justify-end mt-8 border-t border-border pt-6">
            <button
              onClick={() => { setTempPassword(null); onInvited(); }}
              className="px-8 py-3 text-[11px] font-bold uppercase bg-accent-blue text-[var(--color-btn-text-inverse)] hover:bg-accent-blue/90 transition-all"
            >
              System Ready
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} aria-label="Close" />
      <div role="dialog" aria-modal="true" className="bg-[var(--color-bg-base)] border-2 border-border-heavy p-8 w-full max-w-[520px] relative z-10 shadow-[12px_12px_0px_0px_rgba(0,0,0,0.2)]">
        <h3 className="text-2xl font-bold uppercase tracking-tighter mb-6 flex items-center gap-3">
          <Shield className="h-6 w-6 text-accent-blue" />
          Invite External Identity
        </h3>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Legal Name</label>
              <input
                type="text"
                required
                placeholder="FULL NAME"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full bg-bg-surface border-2 border-border px-4 py-3 text-sm font-bold uppercase tracking-tighter focus:border-accent-blue outline-none transition-all"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Target Email</label>
              <input
                type="email"
                required
                placeholder="EMAIL@DOMAIN.COM"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-bg-surface border-2 border-border px-4 py-3 text-sm focus:border-accent-blue outline-none transition-all font-mono"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">System Role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value as 'agent' | 'support')}
              className="w-full bg-bg-surface border-2 border-border px-4 py-3 text-sm font-bold uppercase tracking-widest focus:border-accent-blue outline-none transition-all"
            >
              <option value="agent">Agent (Generative Access)</option>
              <option value="support">Support (Analytical Access)</option>
            </select>
          </div>
          {partnerAuthMethod === 'both' && (
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted block">Authentication Protocol</label>
              <div className="flex flex-col sm:flex-row gap-4 bg-bg-elevated/30 p-3 border-2 border-border">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input type="radio" name="inviteAuthMethod" value="local" checked={authMethod === 'local'}
                    onChange={() => setAuthMethod('local')}
                    className="w-4 h-4 accent-accent-blue" />
                  <span className="text-[10px] font-bold uppercase tracking-widest group-hover:text-accent-blue">Local (Tessera Native)</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input type="radio" name="inviteAuthMethod" value="sso" checked={authMethod === 'sso'}
                    onChange={() => setAuthMethod('sso')}
                    className="w-4 h-4 accent-accent-blue" />
                  <span className="text-[10px] font-bold uppercase tracking-widest group-hover:text-accent-blue">SSO (Microsoft Entra)</span>
                </label>
              </div>
            </div>
          )}
          {role !== 'agent' && departments.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Assigned Departments</label>
                <button
                  type="button"
                  onClick={() => setSelectedDepts(selectedDepts.length === departments.length ? [] : departments.map(d => d.id))}
                  className="text-[8px] font-bold uppercase tracking-widest text-accent-blue hover:underline"
                >
                  {selectedDepts.length === departments.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto border-2 border-border p-3 bg-bg-elevated/30">
                {departments.map(d => (
                  <label key={d.id} className="flex items-center gap-3 text-[10px] font-bold uppercase cursor-pointer hover:text-accent-blue transition-colors py-1">
                    <input
                      type="checkbox"
                      checked={selectedDepts.includes(d.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedDepts([...selectedDepts, d.id]);
                        else setSelectedDepts(selectedDepts.filter(id => id !== d.id));
                      }}
                      className="w-4 h-4 accent-accent-blue"
                    />
                    {d.name}
                  </label>
                ))}
              </div>
              {role === 'support' && selectedDepts.length === 0 && (
                <p className="text-[8px] font-bold uppercase text-accent-red tracking-widest">Support requires at least one department</p>
              )}
            </div>
          )}
          <div className="flex gap-4 pt-6 border-t border-border">
            <button type="button" onClick={onClose} className="flex-1 py-3 text-[11px] font-bold uppercase border-2 border-border-heavy hover:bg-bg-elevated transition-all">Abort</button>
            <button type="submit" disabled={inviteMutation.isPending || (role === 'support' && selectedDepts.length === 0)} className="flex-1 py-3 text-[11px] font-bold uppercase bg-accent-blue text-[var(--color-btn-text-inverse)] hover:bg-accent-blue/90 disabled:opacity-50 transition-all shadow-[6px_6px_0px_0px_rgba(59,130,246,0.1)]">
              {inviteMutation.isPending ? 'Encrypting...' : 'Provision User'}
            </button>
          </div>
        </form>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </div>
    </div>
  );
}

import { useState, useMemo } from 'react';
import { trpc } from '../../utils/trpc';
import useStore, { useStoreShallow } from '../../store/useStore';
import { useT } from '../../i18n';
import { Pencil, Check, X, Search, Users, Shield, User, UserX, Trash2, ChevronLeft, ChevronRight, UserPlus } from 'lucide-react';
import Toast from '../Toast';
import ConfirmDialog from '../ConfirmDialog';
import GuestBadge from '../GuestBadge';
import { getStatusColors, getStatusI18nKey } from '../../utils/statusColors';
import { OnlineSupport } from '../../types';
import { useIsExternalAdmin } from '../../hooks/useIsExternalAdmin';

// Shared Soft Product style constants — mirrors the other admin panels.
const CARD = 'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)]';
const INPUT = 'h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';
const PRIMARY_BTN = 'h-9 px-4 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-accent)] hover:brightness-110 text-white text-[13px] font-medium shadow-[var(--shadow-soft)] disabled:opacity-40 disabled:cursor-not-allowed transition-all';
const SECONDARY_BTN = 'h-9 px-3 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[var(--color-ink)] text-[13px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const FIELD_LABEL = 'block text-[11px] font-medium text-[var(--color-ink-muted)] mb-1.5';
const COL_HEAD = 'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]';

export default function AdminTeam() {
  const t = useT();
  const isExternal = useIsExternalAdmin();
  const guestTooltip = t('guest_admin_disabled_tooltip');
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
  const [showAdmins, setShowAdmins] = useState(false);
  const LIMIT = 20;

  const utils = trpc.useUtils();
  const invalidate = () => utils.partner.listMembers.invalidate();
  const { data, isLoading } = trpc.partner.listMembers.useQuery(
    {
      limit: LIMIT,
      offset: page * LIMIT,
      search: search.trim() || undefined,
      role: roleFilter || undefined,
      excludeAdmin: !showAdmins,
    },
    { enabled: !!activeMembershipId }
  );

  // Data comes pre-filtered from server (admins excluded unless toggled, role filter applied)
  const filteredData = data ?? [];

  // Summary counts — mirrors the table's admin visibility so the "All Members"
  // card agrees with the row count when admins are toggled on.
  const { data: allData } = trpc.partner.listMembers.useQuery(
    { limit: 100, offset: 0, excludeAdmin: !showAdmins },
    { enabled: !!activeMembershipId }
  );
  const stats = useMemo(() => {
    const all = allData ?? [];
    if (!all.length) return { total: 0, agents: 0, support: 0, unconfigured: 0, online: 0 };
    return {
      total: all.length,
      agents: all.filter(m => m.role === 'agent').length,
      support: all.filter(m => m.role === 'support').length,
      unconfigured: all.filter(m => m.role === 'support' && (!m.departments || !Array.isArray(m.departments) || m.departments.length === 0)).length,
      online: all.filter(m => onlineStatusMap.has(m.userId)).length,
    };
  }, [allData, onlineStatusMap]);

  const displayData = useMemo(() => {
    let result = filteredData;
    if (onlineOnly) {
      result = result.filter(m => onlineStatusMap.has(m.userId));
    }
    if (unconfiguredOnly) {
      result = result.filter(m => m.role === 'support' && (!m.departments || !Array.isArray(m.departments) || m.departments.length === 0));
    }
    return result;
  }, [filteredData, onlineOnly, unconfiguredOnly, onlineStatusMap]);

  const removeMutation = trpc.partner.removeMember.useMutation({
    onSuccess: invalidate,
    onError: (err) => setToast({ message: err.message, type: 'error' })
  });

  const updateMemberMutation = trpc.partner.updateMember.useMutation({
    onSuccess: () => { setEditingMembershipId(null); invalidate(); },
    onError: (err) => setToast({ message: err.message, type: 'error' })
  });

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [editingMembershipId, setEditingMembershipId] = useState<string | null>(null);
  const [editDepts, setEditDepts] = useState<string[]>([]);
  const [confirmRemove, setConfirmRemove] = useState<{ membershipId: string; name: string } | null>(null);

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
    <div className="flex flex-col min-h-full space-y-5">
      {/* Header & Main Controls */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pb-1">
        <div className="flex items-center gap-3">
          <Users className="h-5 w-5 text-[var(--color-accent)]" aria-hidden />
          <div>
            <h2 className="text-xl font-semibold text-[var(--color-ink)] tracking-tight">Team management</h2>
            <p className="text-[13px] text-[var(--color-ink-soft)] mt-0.5">
              Define roles and departmental access for your organization.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto">
          <div className="relative min-w-[280px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-ink-muted)] pointer-events-none" aria-hidden />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Filter by name, role, or department…"
              className={`${INPUT} pl-8 pr-8 w-full`}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors"
                aria-label="Clear search"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none whitespace-nowrap text-[var(--color-ink-soft)]">
            <input
              type="checkbox"
              id="show-admins-toggle"
              checked={showAdmins}
              onChange={(e) => { setShowAdmins(e.target.checked); setPage(0); }}
              className="w-3.5 h-3.5 accent-[var(--color-accent)] cursor-pointer"
            />
            <span>Show admins</span>
          </label>
          <button
            onClick={() => setShowInviteModal(true)}
            disabled={isExternal}
            aria-disabled={isExternal || undefined}
            title={isExternal ? guestTooltip : undefined}
            data-guest-disabled={isExternal || undefined}
            className={`${PRIMARY_BTN} whitespace-nowrap`}
          >
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            Invite external
          </button>
        </div>
      </div>

      {/* Stats row — each card is a filter. Active card gets accent-soft bg. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: 'All members', value: stats.total, icon: Users, handler: () => handleRoleFilter(''), active: !roleFilter && !onlineOnly && !unconfiguredOnly, tint: 'text-[var(--color-ink)]' },
          { label: 'Support staff', value: stats.support, icon: Shield, handler: () => handleRoleFilter('support'), active: roleFilter === 'support', tint: 'text-[var(--color-accent)]' },
          { label: 'Agents', value: stats.agents, icon: User, handler: () => handleRoleFilter('agent'), active: roleFilter === 'agent', tint: 'text-[var(--color-accent)]' },
          { label: 'Unconfigured', value: stats.unconfigured, icon: UserX, handler: handleUnconfiguredFilter, active: unconfiguredOnly, tint: 'text-[var(--color-accent-amber)]' },
          { label: 'Online now', value: stats.online, icon: Check, handler: handleOnlineFilter, active: onlineOnly, tint: 'text-[var(--color-accent-green)]' },
        ].map((stat) => (
          <button
            key={stat.label}
            onClick={stat.handler}
            className={`rounded-[var(--radius-card)] p-3.5 text-left transition-all ${
              stat.active
                ? 'bg-[var(--color-accent-soft)] shadow-[var(--shadow-card)] ring-1 ring-[var(--color-accent)]'
                : 'bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)] hover:shadow-[var(--shadow-card)]'
            }`}
          >
            <div className="flex justify-between items-start mb-2">
              <span className="text-[11px] font-medium text-[var(--color-ink-muted)]">{stat.label}</span>
              <stat.icon className={`h-4 w-4 ${stat.tint} opacity-80`} aria-hidden />
            </div>
            <span className="text-2xl font-semibold text-[var(--color-ink)] tabular-nums tracking-tight">{stat.value}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className={`${CARD} flex-1 flex flex-col items-center justify-center py-24`}>
          <div className="w-8 h-8 rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin mb-3" aria-hidden />
          <p className="text-[12px] text-[var(--color-ink-muted)]">Loading directory…</p>
        </div>
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className={COL_HEAD}>Identity</th>
                  <th className={COL_HEAD}>Role</th>
                  <th className={`${COL_HEAD} text-center`}>Status</th>
                  <th className={COL_HEAD}>Department access</th>
                  <th className={`${COL_HEAD} text-right`}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {displayData.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-20 text-center">
                      <Search className="h-9 w-9 mx-auto text-[var(--color-ink-muted)] opacity-50 mb-3" aria-hidden />
                      <p className="text-[13px] font-medium text-[var(--color-ink)]">No members match {search ? `"${search}"` : 'the current filters'}</p>
                      {search && (
                        <button
                          onClick={() => setSearch('')}
                          className="mt-3 text-[12px] text-[var(--color-accent)] hover:underline"
                        >
                          Clear search
                        </button>
                      )}
                    </td>
                  </tr>
                ) : displayData.map((member) => (
                  <tr key={member.membershipId} className="hover:bg-[var(--color-hover)] transition-colors group/row">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[var(--color-bg-elevated)] flex items-center justify-center font-semibold text-[11px] text-[var(--color-ink)] shrink-0">
                          {member.name?.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <span title={member.email || undefined} className="text-[13px] font-medium text-[var(--color-ink)] truncate">{member.name}</span>
                            <GuestBadge isExternal={member.isExternal} />
                          </div>
                          <div className="flex flex-col gap-0.5 mt-0.5">
                            {member.isExternal && (
                              <span className="text-[11px] font-mono text-[var(--color-ink-muted)] truncate">{member.email}</span>
                            )}
                            <div className="flex items-center gap-2">
                              {member.isExternal && !member.externalId && !member.lastActiveAt ? (
                                <span className="inline-flex items-center px-1.5 h-4 rounded-[var(--radius-pill)] bg-[var(--color-accent-soft)] text-[10px] font-medium text-[var(--color-accent)]">Invite pending</span>
                              ) : member.lastActiveAt && (
                                <span className="text-[11px] text-[var(--color-ink-muted)]">
                                  Last active {new Date(member.lastActiveAt).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 h-6 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] text-[11px] font-medium text-[var(--color-ink)] capitalize">
                        {member.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {(() => {
                        const onlineStatus = onlineStatusMap.get(member.userId);
                        const colors = getStatusColors(onlineStatus);
                        const label = onlineStatus ? t(getStatusI18nKey(onlineStatus)) : t('status_offline');
                        return (
                          <div className="inline-flex items-center gap-1.5" title={label}>
                            <span className={`w-2 h-2 rounded-full ${colors.dot}`} aria-hidden />
                            <span className={`text-[11px] ${colors.text}`}>{label}</span>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      {member.role === 'agent' ? (
                        <span className="text-[12px] text-[var(--color-ink-muted)] italic">Selects per ticket</span>
                      ) : editingMembershipId === member.membershipId ? (
                        <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-soft)] p-3 min-w-[220px] space-y-2">
                          <div className="max-h-40 overflow-y-auto pr-1 space-y-0.5">
                            {departments.map(d => (
                              <label key={d.id} className="flex items-center gap-2 cursor-pointer py-1 px-2 rounded-[var(--radius-btn)] hover:bg-[var(--color-hover)] transition-colors">
                                <input
                                  type="checkbox"
                                  checked={editDepts.includes(d.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) setEditDepts([...editDepts, d.id]);
                                    else setEditDepts(editDepts.filter(id => id !== d.id));
                                  }}
                                  className="w-3.5 h-3.5 accent-[var(--color-accent)]"
                                />
                                <span className="text-[12px] text-[var(--color-ink)]">{d.name}</span>
                              </label>
                            ))}
                          </div>
                          {member.role === 'support' && editDepts.length === 0 && (
                            <p className="text-[11px] text-[var(--color-urgent)]">Support requires at least one department</p>
                          )}
                          <div className="flex items-center gap-2 pt-2 border-t border-[var(--color-border)]">
                            <button
                              onClick={() => updateMemberMutation.mutate({ membershipId: member.membershipId, departments: editDepts })}
                              disabled={isExternal || updateMemberMutation.isPending || (member.role === 'support' && editDepts.length === 0)}
                              aria-disabled={isExternal || undefined}
                              title={isExternal ? guestTooltip : undefined}
                              data-guest-disabled={isExternal || undefined}
                              className={`${PRIMARY_BTN} flex-1 justify-center h-8`}
                            >
                              {updateMemberMutation.isPending ? '…' : 'Save'}
                            </button>
                            <button
                              onClick={() => setEditingMembershipId(null)}
                              className={`${SECONDARY_BTN} flex-1 justify-center h-8`}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          aria-disabled={isExternal || undefined}
                          title={isExternal ? guestTooltip : undefined}
                          data-guest-disabled={isExternal || undefined}
                          className={`group/dept flex flex-wrap gap-1.5 items-center min-h-[28px] rounded-[var(--radius-btn)] p-1 -m-1 transition-colors ${isExternal ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-[var(--color-hover)]'}`}
                          onClick={() => {
                            if (isExternal) return;
                            setEditingMembershipId(member.membershipId);
                            setEditDepts((member.departments as string[]) || []);
                          }}
                        >
                          {member.departments && (member.departments as string[]).length > 0
                            ? (member.departments as string[]).map((dId: string) => {
                                const dInfo = departments.find(d => d.id === dId);
                                return (
                                  <span key={dId} className="inline-flex items-center px-2 h-6 rounded-[var(--radius-pill)] bg-[var(--color-accent-soft)] text-[11px] font-medium text-[var(--color-accent)]">
                                    {dInfo ? dInfo.name : dId}
                                  </span>
                                );
                              })
                            : <span className="text-[12px] text-[var(--color-ink-muted)] italic">No departments assigned</span>}
                          <Pencil className="h-3 w-3 opacity-0 group-hover/row:opacity-60 transition-opacity ml-auto text-[var(--color-ink-muted)]" aria-hidden />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setConfirmRemove({ membershipId: member.membershipId, name: member.name })}
                        disabled={isExternal}
                        aria-disabled={isExternal || undefined}
                        title={isExternal ? guestTooltip : undefined}
                        data-guest-disabled={isExternal || undefined}
                        className="w-8 h-8 inline-flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[color-mix(in_srgb,var(--color-urgent)_14%,transparent)] hover:text-[var(--color-urgent)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed opacity-0 group-hover/row:opacity-100"
                        aria-label={`Remove ${member.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-[var(--color-border)] flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-[12px] text-[var(--color-ink-muted)]">
              <span>
                Showing <span className="text-[var(--color-ink)] tabular-nums">{displayData.length}</span> {displayData.length === 1 ? 'member' : 'members'}
              </span>
              <span className="text-[var(--color-border)]">|</span>
              <span>
                Limit <span className="text-[var(--color-ink)] tabular-nums">{LIMIT}</span>
              </span>
            </div>
            <div className="flex gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                className={SECONDARY_BTN}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                Previous
              </button>
              <button
                disabled={displayData.length < LIMIT}
                onClick={() => setPage(p => p + 1)}
                className={SECONDARY_BTN}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      )}

      {showInviteModal && <InviteExternalUserModal onClose={() => setShowInviteModal(false)} onInvited={() => { setShowInviteModal(false); invalidate(); }} />}
      {confirmRemove && (
        <ConfirmDialog
          title={t('remove_member_title') || 'Remove member'}
          message={`Remove ${confirmRemove.name} from this partner? They will lose access to all partner resources.`}
          confirmLabel={t('remove') || 'Remove'}
          onConfirm={() => {
            removeMutation.mutate({ membershipId: confirmRemove.membershipId });
            setConfirmRemove(null);
          }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

function InviteExternalUserModal({ onClose, onInvited }: { onClose: () => void, onInvited: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'support'|'admin'>('support');
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const { activeMembershipId, memberships } = useStoreShallow((s) => ({
    activeMembershipId: s.activeMembershipId,
    memberships: s.memberships,
  }));
  const activeMembership = memberships.find(m => m.id === activeMembershipId);
  const departments = activeMembership?.manifest?.departments || [];

  const inviteMutation = trpc.partner.inviteExternalUser.useMutation({
    onSuccess: () => {
      onInvited();
    },
    onError: (err) => setToast({ message: err.message, type: 'error' })
  });

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    inviteMutation.mutate({
      email, name, role, departments: selectedDepts,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-[fade-in_150ms_ease-out]">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-label="Close" />
      <div
        role="dialog"
        aria-modal="true"
        className="rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-modal)] p-6 w-full max-w-[520px] relative z-10 animate-[v2p-pop_180ms_ease-out]"
      >
        <div className="flex items-center gap-2.5 mb-5">
          <Shield className="h-5 w-5 text-[var(--color-accent)]" aria-hidden />
          <h3 className="text-lg font-semibold text-[var(--color-ink)]">Invite external user</h3>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={FIELD_LABEL}>Name</label>
              <input
                type="text"
                required
                placeholder="Full name"
                value={name}
                onChange={e => setName(e.target.value)}
                className={`${INPUT} w-full`}
              />
            </div>
            <div>
              <label className={FIELD_LABEL}>Email</label>
              <input
                type="email"
                required
                placeholder="user@domain.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className={`${INPUT} w-full font-mono text-[12px]`}
              />
            </div>
          </div>
          <div>
            <label className={FIELD_LABEL}>Role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value as 'support' | 'admin')}
              className={`${INPUT} w-full`}
            >
              <option value="support">External support</option>
              <option value="admin">Partner manager / SPOC</option>
            </select>
          </div>
          {role === 'support' && departments.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className={FIELD_LABEL}>Assigned departments</label>
                <button
                  type="button"
                  onClick={() => setSelectedDepts(selectedDepts.length === departments.length ? [] : departments.map(d => d.id))}
                  className="text-[12px] text-[var(--color-accent)] hover:underline"
                >
                  {selectedDepts.length === departments.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] p-2">
                {departments.map(d => (
                  <label key={d.id} className="flex items-center gap-2 text-[12px] text-[var(--color-ink)] cursor-pointer rounded-[var(--radius-btn)] px-2 py-1 hover:bg-[var(--color-hover)] transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedDepts.includes(d.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedDepts([...selectedDepts, d.id]);
                        else setSelectedDepts(selectedDepts.filter(id => id !== d.id));
                      }}
                      className="w-3.5 h-3.5 accent-[var(--color-accent)]"
                    />
                    <span>{d.name}</span>
                  </label>
                ))}
              </div>
              {role === 'support' && selectedDepts.length === 0 && (
                <p className="text-[11px] text-[var(--color-urgent)]">Support requires at least one department</p>
              )}
            </div>
          )}
          <div className="flex gap-2 pt-3 border-t border-[var(--color-border)]">
            <button type="button" onClick={onClose} className={`${SECONDARY_BTN} flex-1 justify-center`}>Cancel</button>
            <button
              type="submit"
              disabled={inviteMutation.isPending || (role === 'support' && selectedDepts.length === 0)}
              className={`${PRIMARY_BTN} flex-1 justify-center`}
            >
              {inviteMutation.isPending ? 'Sending…' : 'Send invite'}
            </button>
          </div>
        </form>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </div>
    </div>
  );
}

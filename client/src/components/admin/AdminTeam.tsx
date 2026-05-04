import { useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { trpc } from '../../utils/trpc';
import { useStoreShallow } from '../../store/useStore';
import { useT } from '../../i18n';
import { Pencil, X, Search, Users, Shield, Trash2, ChevronLeft, ChevronRight, UserPlus, Moon, FileText, AlertTriangle } from 'lucide-react';
import Toast from '../Toast';
import ConfirmDialog from '../ConfirmDialog';
import MemberAuditDrawer from './MemberAuditDrawer';
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

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [roleFilter, setRoleFilter] = useState<'agent' | 'support' | ''>('');
  const [dormantOnly, setDormantOnly] = useState(false);
  const [guestsOnly, setGuestsOnly] = useState(false);
  const [auditUserId, setAuditUserId] = useState<{ id: string; name: string } | null>(null);
  const LIMIT = 12;

  const utils = trpc.useUtils();
  const invalidate = () => {
    utils.partner.listMembers.invalidate();
    utils.partner.memberStats.invalidate();
  };
  const { data, isLoading } = trpc.partner.listMembers.useQuery(
    {
      limit: LIMIT,
      offset: page * LIMIT,
      search: search.trim() || undefined,
      role: roleFilter || undefined,
      excludeAdmin: false,
      excludePending: true,
      dormant: dormantOnly || undefined,
      isExternal: guestsOnly || undefined,
    },
    { enabled: !!activeMembershipId, placeholderData: keepPreviousData }
  );

  const displayData = data ?? [];

  const { data: stats } = trpc.partner.memberStats.useQuery(undefined, {
    enabled: !!activeMembershipId,
  });
  const { data: pendingInvites } = trpc.partner.listMembers.useQuery(
    { limit: 50, offset: 0, excludeAdmin: false, pendingInvite: true },
    { enabled: !!activeMembershipId && !isExternal }
  );
  const total = stats?.total ?? 0;
  const supportCount = stats?.support ?? 0;
  const agentCount = stats?.agents ?? 0;
  const dormantCount = stats?.dormant ?? 0;
  const guestsCount = stats?.guests ?? 0;

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
    setDormantOnly(false);
    setGuestsOnly(false);
    setPage(0);
  };

  const handleDormantFilter = () => {
    setRoleFilter('');
    setGuestsOnly(false);
    setDormantOnly(!dormantOnly);
    setPage(0);
  };

  const handleGuestsFilter = () => {
    setRoleFilter('');
    setDormantOnly(false);
    setGuestsOnly(!guestsOnly);
    setPage(0);
  };

  const pillBase = 'h-7 px-2.5 inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] text-[12px] font-medium transition-colors whitespace-nowrap';
  const filters: Array<{ key: string; label: string; count: number; active: boolean; handler: () => void }> = [
    { key: 'all', label: 'All', count: total, active: !roleFilter && !dormantOnly && !guestsOnly, handler: () => handleRoleFilter('') },
    { key: 'support', label: 'Support', count: supportCount, active: roleFilter === 'support', handler: () => handleRoleFilter('support') },
    { key: 'agents', label: 'Agents', count: agentCount, active: roleFilter === 'agent', handler: () => handleRoleFilter('agent') },
    { key: 'guests', label: 'Guest B2B', count: guestsCount, active: guestsOnly, handler: handleGuestsFilter },
  ];

  return (
    <div className="flex flex-col min-h-full space-y-3">
      {/* Header & Main Controls */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 pb-1">
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
          {dormantCount > 0 && (
            <button
              onClick={handleDormantFilter}
              title="B2B guests inactive for 30+ days — review for removal"
              className={`h-9 px-3 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] text-[12px] font-medium transition-colors whitespace-nowrap border ${
                dormantOnly
                  ? 'bg-[var(--color-accent-amber)] text-white border-[var(--color-accent-amber)]'
                  : 'border-[var(--color-accent-amber)] text-[var(--color-accent-amber)] hover:bg-[color-mix(in_srgb,var(--color-accent-amber)_14%,transparent)]'
              }`}
            >
              <Moon className="h-3.5 w-3.5" aria-hidden />
              {dormantCount} stale {dormantCount === 1 ? 'guest' : 'guests'}
            </button>
          )}
        </div>
      </div>

      {/* Filter pills — compact replacement for the prior 3-card stat grid.
          Each pill is both an at-a-glance count and a filter toggle. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={f.handler}
            className={`${pillBase} ${
              f.active
                ? 'bg-[var(--color-accent)] text-white'
                : 'bg-[var(--color-bg-surface)] text-[var(--color-ink)] hover:bg-[var(--color-hover)]'
            }`}
          >
            {f.label}
            <span className={`tabular-nums ${f.active ? 'opacity-80' : 'text-[var(--color-ink-muted)]'}`}>{f.count}</span>
          </button>
        ))}
      </div>

      {/* B2B Guests — invite + pending Azure handoff list. Internal SSO members
          are not shown here (they self-provision via Azure group mapping). Hidden
          from B2B guest admins themselves. */}
      {!isExternal && (
        <div className={`${CARD} px-4 py-3`}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 shrink-0">
              <AlertTriangle className="h-4 w-4 text-[var(--color-accent-amber)]" aria-hidden />
              <div>
                <span className="text-[13px] font-semibold text-[var(--color-ink)]">B2B Guest invites</span>
                <p className="text-[11px] text-[var(--color-ink-muted)]">
                  {pendingInvites && pendingInvites.length > 0
                    ? `${pendingInvites.length} awaiting Azure tenant registration`
                    : 'No pending invites — invite an external partner to start'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 flex-1">
              {pendingInvites?.map((p) => (
                <span
                  key={p.membershipId}
                  title={p.email || undefined}
                  className="inline-flex items-center gap-2 pl-1 pr-2.5 h-7 rounded-[var(--radius-pill)] bg-[color-mix(in_srgb,var(--color-accent-amber)_14%,transparent)]"
                >
                  <span className="w-5 h-5 rounded-full bg-[var(--color-accent-amber)] text-white flex items-center justify-center text-[9px] font-semibold">
                    {p.name?.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="text-[12px] text-[var(--color-ink)] truncate max-w-[160px]">{p.name}</span>
                  <span className="text-[10px] uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">{p.role}</span>
                </span>
              ))}
            </div>
            <button
              onClick={() => setShowInviteModal(true)}
              className={`${PRIMARY_BTN} whitespace-nowrap shrink-0`}
            >
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
              Invite B2B guest
            </button>
          </div>
        </div>
      )}

      <div className={`${CARD} overflow-hidden flex flex-col`}>
          <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-[12px] text-[var(--color-ink-muted)]">
              <span>
                Showing <span className="text-[var(--color-ink)] tabular-nums">{displayData.length}</span> {displayData.length === 1 ? 'member' : 'members'}
              </span>
              <span className="text-[var(--color-border)]">|</span>
              <span>
                Page <span className="text-[var(--color-ink)] tabular-nums">{page + 1}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-[260px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-ink-muted)] pointer-events-none" aria-hidden />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  placeholder={t('filter_members_placeholder')}
                  aria-label={t('filter_members_placeholder')}
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
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-[var(--color-bg-surface)] shadow-[0_1px_0_var(--color-border)]">
                <tr>
                  <th className={COL_HEAD}>Identity</th>
                  <th className={COL_HEAD}>Role</th>
                  <th className={COL_HEAD}>Department access</th>
                  <th className={`${COL_HEAD} text-right`}></th>
                </tr>
              </thead>
              <tbody className={`divide-y divide-[var(--color-border)] transition-opacity ${isLoading && displayData.length === 0 ? 'opacity-60' : ''}`}>
                {isLoading && displayData.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-20 text-center">
                      <div className="w-8 h-8 mx-auto rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin mb-3" aria-hidden />
                      <p className="text-[12px] text-[var(--color-ink-muted)]">Loading directory…</p>
                    </td>
                  </tr>
                ) : displayData.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-20 text-center">
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
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-[var(--color-bg-elevated)] flex items-center justify-center font-semibold text-[10px] text-[var(--color-ink)] shrink-0">
                          {member.name?.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <span title={member.email || undefined} className="text-[13px] font-medium text-[var(--color-ink)] truncate">{member.name}</span>
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
                                  {t('last_active_on').replace('{date}', new Date(member.lastActiveAt).toLocaleDateString())}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex items-center px-2 h-6 rounded-[var(--radius-pill)] text-[11px] font-medium capitalize ${
                          member.isExternal
                            ? 'bg-[color-mix(in_srgb,var(--color-accent-amber)_18%,transparent)] text-[var(--color-accent-amber)]'
                            : 'bg-[var(--color-bg-elevated)] text-[var(--color-ink)]'
                        }`}
                      >
                        {member.isExternal ? `External ${member.role}` : member.role}
                      </span>
                    </td>
                    <td className="px-4 py-2">
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
                          <Pencil className="h-3 w-3 opacity-40 group-hover/row:opacity-80 transition-opacity ml-auto text-[var(--color-ink-muted)]" aria-hidden />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="inline-flex items-center gap-0.5">
                        <button
                          onClick={() => setAuditUserId({ id: member.userId, name: member.name })}
                          className="w-7 h-7 inline-flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors opacity-0 group-hover/row:opacity-100"
                          aria-label={`Audit history for ${member.name}`}
                          title="Audit history"
                        >
                          <FileText className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        {member.isExternal && (
                          <button
                            onClick={() => setConfirmRemove({ membershipId: member.membershipId, name: member.name })}
                            disabled={isExternal}
                            aria-disabled={isExternal || undefined}
                            title={isExternal ? guestTooltip : 'Remove B2B guest'}
                            data-guest-disabled={isExternal || undefined}
                            className="w-7 h-7 inline-flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[color-mix(in_srgb,var(--color-urgent)_14%,transparent)] hover:text-[var(--color-urgent)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed opacity-0 group-hover/row:opacity-100"
                            aria-label={`Remove ${member.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      {showInviteModal && <InviteExternalUserModal onClose={() => setShowInviteModal(false)} onInvited={() => { setShowInviteModal(false); invalidate(); }} />}
      {confirmRemove && (
        <ConfirmDialog
          title={t('remove_member_title')}
          message={`Remove ${confirmRemove.name} from this partner? They will lose access to all partner resources.`}
          confirmLabel={t('remove')}
          onConfirm={() => {
            removeMutation.mutate({ membershipId: confirmRemove.membershipId });
            setConfirmRemove(null);
          }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
      <MemberAuditDrawer
        userId={auditUserId?.id ?? null}
        userName={auditUserId?.name}
        departments={departments}
        onClose={() => setAuditUserId(null)}
      />
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
  const [invited, setInvited] = useState<{ email: string; name: string; role: 'support' | 'admin' } | null>(null);

  const { activeMembershipId, memberships } = useStoreShallow((s) => ({
    activeMembershipId: s.activeMembershipId,
    memberships: s.memberships,
  }));
  const activeMembership = memberships.find(m => m.id === activeMembershipId);
  const departments = activeMembership?.manifest?.departments || [];

  const inviteMutation = trpc.partner.inviteExternalUser.useMutation({
    onSuccess: () => {
      // Hold the modal open on success to surface the Azure B2B handoff
      // banner — the local record is created, but the invitee can't log in
      // until a platform operator registers them as a guest in the tenant.
      setInvited({ email, name, role });
    },
    onError: (err) => setToast({ message: err.message, type: 'error' })
  });

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    inviteMutation.mutate({
      email, name, role, departments: selectedDepts,
    });
  };

  const handleDismiss = () => { if (invited) onInvited(); else onClose(); };

  if (invited) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-[fade-in_150ms_ease-out]">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleDismiss} aria-label="Close" />
        <div
          role="dialog"
          aria-modal="true"
          className="rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-modal)] p-6 w-full max-w-[520px] relative z-10 animate-[v2p-pop_180ms_ease-out]"
        >
          <div className="flex items-center gap-2.5 mb-5">
            <Shield className="h-5 w-5 text-[var(--color-accent)]" aria-hidden />
            <h3 className="text-lg font-semibold text-[var(--color-ink)]">Local record created</h3>
          </div>
          <div className="space-y-4">
            <div
              className="rounded-[var(--radius-card)] border border-[var(--color-accent-amber)] p-4 space-y-1"
              style={{ background: 'color-mix(in srgb, var(--color-accent-amber) 14%, transparent)' }}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-[var(--color-accent-amber)] shrink-0 mt-0.5" aria-hidden />
                <div className="space-y-1">
                  <p className="text-[13px] font-semibold text-[var(--color-ink)]">Azure B2B invite still required</p>
                  <p className="text-[12px] text-[var(--color-ink-soft)] leading-relaxed">
                    {invited.name} is registered in Guichet but cannot log in yet. A platform operator must add them as a <strong>B2B guest</strong> in the Azure tenant before they can SSO. Forward the handoff details to your IT admin.
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] p-3">
              <p className="text-[11px] font-medium text-[var(--color-ink-muted)] uppercase tracking-[0.06em] mb-2">Handoff details</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                <dt className="text-[var(--color-ink-muted)]">Name</dt>
                <dd className="text-[var(--color-ink)]">{invited.name}</dd>
                <dt className="text-[var(--color-ink-muted)]">Email</dt>
                <dd className="text-[var(--color-ink)] font-mono">{invited.email}</dd>
                <dt className="text-[var(--color-ink-muted)]">Role</dt>
                <dd className="text-[var(--color-ink)] capitalize">{invited.role}</dd>
                <dt className="text-[var(--color-ink-muted)]">Azure step</dt>
                <dd className="text-[var(--color-ink)]">Invite as B2B guest, map tenant groups</dd>
              </dl>
            </div>
            <div className="flex gap-2 pt-2 border-t border-[var(--color-border)]">
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(`${invited.name} <${invited.email}> — needs Azure B2B guest invite for Guichet (role: ${invited.role})`)}
                className={`${SECONDARY_BTN} flex-1 justify-center`}
              >
                Copy handoff
              </button>
              <button
                type="button"
                onClick={onInvited}
                className={`${PRIMARY_BTN} flex-1 justify-center`}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

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

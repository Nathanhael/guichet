import { useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { trpc } from '../../utils/trpc';
import { useStoreShallow } from '../../store/useStore';
import { useT } from '../../i18n';
import { X, Search, Users, ChevronLeft, ChevronRight, FileText, Info, Pencil } from 'lucide-react';
import Toast from '../Toast';
import MemberAuditDrawer from './MemberAuditDrawer';
import Modal, { ModalHeader, ModalBody, ModalFooter } from '../ui/Modal';
import Button from '../ui/Button';
import { CARD, INPUT, SECONDARY_BTN, COL_HEAD } from './adminStyles';

export default function AdminTeam() {
  const t = useT();
  const { activeMembershipId, memberships } = useStoreShallow((s) => ({
    activeMembershipId: s.activeMembershipId,
    memberships: s.memberships,
  }));
  const activeMembership = memberships.find(m => m.id === activeMembershipId);
  const departments = activeMembership?.manifest?.departments || [];

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [roleFilter, setRoleFilter] = useState<'agent' | 'support' | ''>('');
  const [auditUserId, setAuditUserId] = useState<{ id: string; name: string } | null>(null);
  const [editingDepts, setEditingDepts] = useState<{ membershipId: string; name: string; current: string[] } | null>(null);
  const LIMIT = 12;

  const { data, isLoading } = trpc.partner.listMembers.useQuery(
    {
      limit: LIMIT,
      offset: page * LIMIT,
      search: search.trim() || undefined,
      role: roleFilter || undefined,
      excludeAdmin: false,
    },
    { enabled: !!activeMembershipId, placeholderData: keepPreviousData }
  );

  const displayData = data ?? [];

  const { data: stats } = trpc.partner.memberStats.useQuery(undefined, {
    enabled: !!activeMembershipId,
  });
  const total = stats?.total ?? 0;
  const supportCount = stats?.support ?? 0;
  const agentCount = stats?.agents ?? 0;

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const handleRoleFilter = (role: '' | 'agent' | 'support') => {
    setRoleFilter(role);
    setPage(0);
  };

  const pillBase = 'h-7 px-2.5 inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] text-[12px] font-medium transition-colors whitespace-nowrap';
  const filters: Array<{ key: string; label: string; count: number; active: boolean; handler: () => void }> = [
    { key: 'all', label: t('all'), count: total, active: !roleFilter, handler: () => handleRoleFilter('') },
    { key: 'support', label: t('support'), count: supportCount, active: roleFilter === 'support', handler: () => handleRoleFilter('support') },
    { key: 'agents', label: t('filter_agents'), count: agentCount, active: roleFilter === 'agent', handler: () => handleRoleFilter('agent') },
  ];

  return (
    <div className="flex flex-col min-h-full space-y-3">
      {/* Header & Main Controls */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 pb-1">
        <div className="flex items-center gap-3">
          <Users className="h-5 w-5 text-[var(--color-accent)]" aria-hidden />
          <div>
            <h2 className="text-xl font-semibold text-[var(--color-ink)] tracking-tight">{t('team_management_title')}</h2>
            <p className="text-[13px] text-[var(--color-ink-soft)] mt-0.5">
              {t('team_management_desc')}
            </p>
          </div>
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

      {/* Memberships are Azure-managed: roles + access come from SSO group
          mappings. This panel is a read-only roster — to grant, change, or
          revoke access, the platform admin updates Azure group assignments. */}
      <div
        role="note"
        className="flex items-start gap-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2"
      >
        <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-[var(--color-ink-muted)]" aria-hidden />
        <p className="text-[12px] text-[var(--color-ink-soft)] leading-relaxed">
          {t('access_managed_in_azure_banner')}
        </p>
      </div>

      <div className={`${CARD} overflow-hidden flex flex-col`}>
          <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-[12px] text-[var(--color-ink-muted)]">
              <span className="tabular-nums">
                {t(displayData.length === 1 ? 'showing_members_singular' : 'showing_members_plural').replace('{count}', String(displayData.length))}
              </span>
              <span className="text-[var(--color-border)]">|</span>
              <span>
                {t('page_label')} <span className="text-[var(--color-ink)] tabular-nums">{page + 1}</span>
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
                    aria-label={t('clear_search')}
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
                {t('btn_previous')}
              </button>
              <button
                disabled={displayData.length < LIMIT}
                onClick={() => setPage(p => p + 1)}
                className={SECONDARY_BTN}
              >
                {t('btn_next')}
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-[var(--color-bg-surface)] shadow-[0_1px_0_var(--color-border)]">
                <tr>
                  <th className={COL_HEAD}>{t('col_identity')}</th>
                  <th className={COL_HEAD}>{t('col_role')}</th>
                  <th className={COL_HEAD}>{t('col_department_access')}</th>
                  <th className={`${COL_HEAD} text-right`}></th>
                </tr>
              </thead>
              <tbody className={`divide-y divide-[var(--color-border)] transition-opacity ${isLoading && displayData.length === 0 ? 'opacity-60' : ''}`}>
                {isLoading && displayData.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-20 text-center">
                      <div className="w-8 h-8 mx-auto rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin mb-3" aria-hidden />
                      <p className="text-[12px] text-[var(--color-ink-muted)]">{t('loading_directory')}</p>
                    </td>
                  </tr>
                ) : displayData.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-20 text-center">
                      <Search className="h-9 w-9 mx-auto text-[var(--color-ink-muted)] opacity-50 mb-3" aria-hidden />
                      <p className="text-[13px] font-medium text-[var(--color-ink)]">
                        {search
                          ? t('no_members_match_query').replace('{query}', search)
                          : t('no_members_match_filters')}
                      </p>
                      {search && (
                        <button
                          onClick={() => setSearch('')}
                          className="mt-3 text-[12px] text-[var(--color-accent)] hover:underline"
                        >
                          {t('clear_search')}
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
                            {member.lastActiveAt && (
                              <span className="text-[11px] text-[var(--color-ink-muted)]">
                                {t('last_active_on').replace('{date}', new Date(member.lastActiveAt).toLocaleDateString())}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center px-2 h-6 rounded-[var(--radius-pill)] text-[11px] font-medium capitalize bg-[var(--color-bg-elevated)] text-[var(--color-ink)]">
                        {member.role}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {member.role === 'agent' ? (
                        <span className="text-[12px] text-[var(--color-ink-muted)] italic">{t('selects_per_ticket')}</span>
                      ) : member.role === 'support' ? (
                        <button
                          type="button"
                          onClick={() => setEditingDepts({
                            membershipId: member.membershipId,
                            name: member.name,
                            current: (member.departments as string[]) || [],
                          })}
                          className="group/dept w-full text-left flex flex-wrap gap-1.5 items-center min-h-[28px] -mx-2 px-2 py-1 rounded-[var(--radius-btn)] hover:bg-[var(--color-hover)] transition-colors"
                          aria-label={t('edit_departments_for').replace('{name}', member.name)}
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
                            : <span className="text-[12px] text-[var(--color-ink-muted)] italic">{t('no_departments_assigned')}</span>}
                          <Pencil className="h-3 w-3 ml-auto text-[var(--color-ink-muted)] opacity-0 group-hover/dept:opacity-100 transition-opacity" aria-hidden />
                        </button>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 items-center min-h-[28px]">
                          {member.departments && (member.departments as string[]).length > 0
                            ? (member.departments as string[]).map((dId: string) => {
                                const dInfo = departments.find(d => d.id === dId);
                                return (
                                  <span key={dId} className="inline-flex items-center px-2 h-6 rounded-[var(--radius-pill)] bg-[var(--color-accent-soft)] text-[11px] font-medium text-[var(--color-accent)]">
                                    {dInfo ? dInfo.name : dId}
                                  </span>
                                );
                              })
                            : <span className="text-[12px] text-[var(--color-ink-muted)] italic">{t('no_departments_assigned')}</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => setAuditUserId({ id: member.userId, name: member.name })}
                        className="w-7 h-7 inline-flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors opacity-0 group-hover/row:opacity-100"
                        aria-label={t('audit_history_for').replace('{name}', member.name)}
                        title={t('audit_history')}
                      >
                        <FileText className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      <MemberAuditDrawer
        userId={auditUserId?.id ?? null}
        userName={auditUserId?.name}
        departments={departments}
        onClose={() => setAuditUserId(null)}
      />
      {editingDepts && (
        <EditDepartmentsModal
          membershipId={editingDepts.membershipId}
          memberName={editingDepts.name}
          current={editingDepts.current}
          partnerDepartments={departments}
          onClose={() => setEditingDepts(null)}
          onSaved={() => {
            setToast({ message: t('departments_updated'), type: 'success' });
            setEditingDepts(null);
          }}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

function EditDepartmentsModal({
  membershipId,
  memberName,
  current,
  partnerDepartments,
  onClose,
  onSaved,
}: {
  membershipId: string;
  memberName: string;
  current: string[];
  partnerDepartments: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [selected, setSelected] = useState<string[]>(current);
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const mutation = trpc.partner.updateMemberDepartments.useMutation({
    onSuccess: () => {
      utils.partner.listMembers.invalidate();
      utils.partner.memberStats.invalidate();
      onSaved();
    },
    onError: (err) => setError(err.message),
  });

  const toggle = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const allSelected = selected.length === partnerDepartments.length;
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selected.length === 0) {
      setError(t('support_requires_one_department'));
      return;
    }
    mutation.mutate({ membershipId, departments: selected });
  };

  return (
    <Modal open={true} onClose={onClose} id="edit-member-departments" maxWidth={480}>
      <ModalHeader
        onClose={onClose}
        title={t('edit_department_access')}
        subtitle={t('edit_department_access_subtitle').replace('{name}', memberName)}
      />
      <form onSubmit={handleSubmit}>
        <ModalBody className="max-h-[60vh] overflow-y-auto">
          {partnerDepartments.length === 0 ? (
            <p className="text-[13px] text-[var(--color-ink-muted)] italic py-2">{t('no_departments_configured')}</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] text-[var(--color-ink-soft)]">
                  {t('selected_count').replace('{count}', String(selected.length)).replace('{total}', String(partnerDepartments.length))}
                </span>
                <button
                  type="button"
                  onClick={() => setSelected(allSelected ? [] : partnerDepartments.map(d => d.id))}
                  className="text-[12px] font-medium text-[var(--color-accent)] hover:underline"
                >
                  {allSelected ? t('deselect_all') : t('select_all')}
                </button>
              </div>
              <div className="space-y-1 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2">
                {partnerDepartments.map(d => (
                  <label
                    key={d.id}
                    className="flex items-center gap-2 text-[13px] cursor-pointer px-2 py-1.5 rounded-[var(--radius-btn)] hover:bg-[var(--color-hover)]"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(d.id)}
                      onChange={() => toggle(d.id)}
                      className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                    />
                    <span className="text-[var(--color-ink)]">{d.name}</span>
                  </label>
                ))}
              </div>
            </>
          )}
          {error && (
            <p className="text-[12px] text-[var(--color-urgent)] mt-2" role="alert">{error}</p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="secondary" size="md" onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={mutation.isPending || selected.length === 0 || partnerDepartments.length === 0}
          >
            {mutation.isPending ? '…' : t('save')}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

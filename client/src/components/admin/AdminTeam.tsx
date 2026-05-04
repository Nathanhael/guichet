import { useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { trpc } from '../../utils/trpc';
import { useStoreShallow } from '../../store/useStore';
import { useT } from '../../i18n';
import { X, Search, Users, ChevronLeft, ChevronRight, Moon, FileText, Info } from 'lucide-react';
import Toast from '../Toast';
import MemberAuditDrawer from './MemberAuditDrawer';

// Shared Soft Product style constants — mirrors the other admin panels.
const CARD = 'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)]';
const INPUT = 'h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';
const SECONDARY_BTN = 'h-9 px-3 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[var(--color-ink)] text-[13px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const COL_HEAD = 'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]';

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
  const [dormantOnly, setDormantOnly] = useState(false);
  const [guestsOnly, setGuestsOnly] = useState(false);
  const [auditUserId, setAuditUserId] = useState<{ id: string; name: string } | null>(null);
  const LIMIT = 12;

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
  const total = stats?.total ?? 0;
  const supportCount = stats?.support ?? 0;
  const agentCount = stats?.agents ?? 0;
  const dormantCount = stats?.dormant ?? 0;
  const guestsCount = stats?.guests ?? 0;

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

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
    { key: 'all', label: t('all'), count: total, active: !roleFilter && !dormantOnly && !guestsOnly, handler: () => handleRoleFilter('') },
    { key: 'support', label: t('support'), count: supportCount, active: roleFilter === 'support', handler: () => handleRoleFilter('support') },
    { key: 'agents', label: t('filter_agents'), count: agentCount, active: roleFilter === 'agent', handler: () => handleRoleFilter('agent') },
    { key: 'guests', label: t('filter_guests_b2b'), count: guestsCount, active: guestsOnly, handler: handleGuestsFilter },
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

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto">
          {dormantCount > 0 && (
            <button
              onClick={handleDormantFilter}
              title={t('dormant_guest_review_tooltip')}
              className={`h-9 px-3 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] text-[12px] font-medium transition-colors whitespace-nowrap border ${
                dormantOnly
                  ? 'bg-[var(--color-accent-amber)] text-white border-[var(--color-accent-amber)]'
                  : 'border-[var(--color-accent-amber)] text-[var(--color-accent-amber)] hover:bg-[color-mix(in_srgb,var(--color-accent-amber)_14%,transparent)]'
              }`}
            >
              <Moon className="h-3.5 w-3.5" aria-hidden />
              {dormantCount} {t(dormantCount === 1 ? 'stale_guest_singular' : 'stale_guest_plural')}
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

      {/* Memberships are Azure-managed: roles + access come from SSO group
          mappings, B2B guests are provisioned in Entra. This panel is a
          read-only roster — to grant, change, or revoke access, the platform
          admin updates Azure group assignments. */}
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
                            {member.isExternal && (
                              <span className="text-[11px] font-mono text-[var(--color-ink-muted)] truncate">{member.email}</span>
                            )}
                            <div className="flex items-center gap-2">
                              {member.isExternal && !member.externalId && !member.lastActiveAt ? (
                                <span className="inline-flex items-center px-1.5 h-4 rounded-[var(--radius-pill)] bg-[var(--color-accent-soft)] text-[10px] font-medium text-[var(--color-accent)]">{t('invite_pending_pill')}</span>
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
                        {member.isExternal ? t('external_role_prefix').replace('{role}', member.role) : member.role}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {member.role === 'agent' ? (
                        <span className="text-[12px] text-[var(--color-ink-muted)] italic">{t('selects_per_ticket')}</span>
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
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

import React from 'react';
import { useStoreShallow } from '../store/useStore';
import { useT } from '../i18n';
import { formatBusinessHoursTimestamp, getBusinessHoursReason } from '../utils/businessHours';

interface BusinessHoursGuardProps {
  children: React.ReactNode;
  mode?: 'block' | 'notice';
}

export default function BusinessHoursGuard({ children, mode = 'block' }: BusinessHoursGuardProps) {
  const { businessHoursStatus, user, memberships, activeMembershipId, logout } = useStoreShallow(s => ({
    businessHoursStatus: s.businessHoursStatus,
    user: s.user,
    memberships: s.memberships,
    activeMembershipId: s.activeMembershipId,
    logout: s.logout
  }));
  const t = useT();
  const activeMembership = memberships.find((membership) => membership.id === activeMembershipId);
  const partnerName = activeMembership?.partnerName || 'Current workspace';

  if (businessHoursStatus && !businessHoursStatus.isOpen && mode === 'block') {
    return (
      <div className="h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)] flex flex-col overflow-hidden" data-testid="business-hours-guard">
        <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-bold text-2xl uppercase tracking-tighter">TESSERA</span>
            <span className="text-[10px] bg-[var(--color-text-primary)] text-[var(--color-bg-base)] px-2.5 py-1 font-bold uppercase tracking-wide font-mono">
              {t('agent')}
            </span>
            <div className="h-6 w-px bg-[var(--color-border)]" />
            <span className="text-sm font-bold uppercase tracking-wide font-mono">{partnerName}</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
              {t('support_chat_closed')}
            </span>
            <button
              onClick={logout}
              className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] border border-[var(--color-border)] px-3 py-1.5 transition-colors duration-150"
            >
              {t('sign_out')}
            </button>
          </div>
        </div>
        <div className="flex-1 grid grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] overflow-hidden">
          <div className="border-r border-[var(--color-border)] px-10 py-10 flex flex-col justify-between">
            <div className="space-y-6">
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">Logged in as</p>
                <p className="text-lg font-bold uppercase tracking-tight">
                  {user?.name || 'Authenticated user'}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
                  Workspace: {partnerName}
                </p>
              </div>
              <div className="space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">Status</p>
                <h1 className="text-5xl font-bold uppercase leading-none tracking-tight max-w-3xl">
                  Support intake is closed.
                </h1>
              </div>
              <div className="max-w-2xl space-y-3 text-sm font-bold leading-relaxed">
                <p>New requests cannot be submitted right now.</p>
                {getBusinessHoursReason(businessHoursStatus) && (
                  <p>Reason: {getBusinessHoursReason(businessHoursStatus)}</p>
                )}
              </div>
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
              Existing conversations remain available when already open.
            </div>
          </div>
          <div className="px-10 py-10 flex flex-col justify-center">
            <div className="border border-[var(--color-border-heavy)] p-8 space-y-6">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">Availability</p>
                <p className="mt-3 text-3xl font-bold uppercase leading-tight">
                  {businessHoursStatus.nextOpenAt
                    ? `Reopens ${formatBusinessHoursTimestamp(businessHoursStatus.nextOpenAt, businessHoursStatus.timezone)}`
                    : 'Currently closed'}
                </p>
              </div>
              <div className="border-t border-[var(--color-border)] pt-6 space-y-2 text-sm font-bold">
                <p>Timezone: {businessHoursStatus.timezone}</p>
                {businessHoursStatus.nextOpenAt && (
                  <p>Next opening window starts at the time shown above.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (businessHoursStatus && !businessHoursStatus.isOpen && mode === 'notice') {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <div className="shrink-0 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] text-xs font-bold">
          <span>Support is currently closed.</span>
          {businessHoursStatus.nextOpenAt && (
            <span className="ml-2 opacity-80">
              Reopens {formatBusinessHoursTimestamp(businessHoursStatus.nextOpenAt, businessHoursStatus.timezone)}
            </span>
          )}
          {getBusinessHoursReason(businessHoursStatus) && (
            <span className="ml-2 opacity-80">Reason: {getBusinessHoursReason(businessHoursStatus)}</span>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
      </div>
    );
  }

  return <>{children}</>;
}

import React from 'react';
import { Pause } from 'lucide-react';
import { useStoreShallow } from '../store/useStore';
import { useT } from '../i18n';
import { APP_NAME } from '../constants';
import { formatBusinessHoursTimestamp, getBusinessHoursReason } from '../utils/businessHours';
import Button from './ui/Button';
import Pill from './ui/Pill';

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
    const reason = getBusinessHoursReason(businessHoursStatus);
    const reopens = businessHoursStatus.nextOpenAt
      ? formatBusinessHoursTimestamp(businessHoursStatus.nextOpenAt, businessHoursStatus.timezone)
      : null;

    return (
      <div className="h-screen bg-[var(--color-bg-base)] text-[var(--color-ink)] flex flex-col overflow-hidden" data-testid="business-hours-guard">
        <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-[15px] tracking-[-0.2px]">{APP_NAME}</span>
            <Pill tone="accent">{t('agent')}</Pill>
            <div className="h-4 w-px bg-[var(--color-border)]" />
            <span className="text-[13px] text-[var(--color-ink-soft)]">{partnerName}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={logout}>
            {t('sign_out')}
          </Button>
        </div>

        <div className="flex-1 overflow-auto flex items-center justify-center px-6 py-10">
          <div className="w-full max-w-xl rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)] p-10 text-center">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent-amber) 14%, transparent)' }}
            >
              <Pause className="h-6 w-6 text-[var(--color-accent-amber)]" strokeWidth={2} />
            </div>
            <h1 className="text-[24px] font-semibold tracking-[-0.3px] mb-2">
              {t('support_chat_closed') || 'Support is closed'}
            </h1>
            <p className="text-[13px] text-[var(--color-ink-muted)] leading-relaxed mb-6 max-w-sm mx-auto">
              New requests can't be submitted right now. Existing conversations remain available when already open.
            </p>

            <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] px-5 py-4 text-left space-y-3">
              {reopens && (
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[11px] text-[var(--color-ink-muted)]">Reopens</span>
                  <span className="text-[13px] font-medium text-[var(--color-ink)] text-right">{reopens}</span>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-[11px] text-[var(--color-ink-muted)]">Timezone</span>
                <span className="text-[13px] text-[var(--color-ink-soft)] text-right">{businessHoursStatus.timezone}</span>
              </div>
              {reason && (
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[11px] text-[var(--color-ink-muted)]">Reason</span>
                  <span className="text-[13px] text-[var(--color-ink-soft)] text-right">{reason}</span>
                </div>
              )}
              <div className="pt-3 border-t border-[var(--color-border)] flex items-baseline justify-between gap-4">
                <span className="text-[11px] text-[var(--color-ink-muted)]">Signed in as</span>
                <span className="text-[13px] text-[var(--color-ink-soft)] text-right truncate">{user?.name || 'Authenticated user'}</span>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-[11px] text-[var(--color-ink-muted)]">Workspace</span>
                <span className="text-[13px] text-[var(--color-ink-soft)] text-right truncate">{partnerName}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (businessHoursStatus && !businessHoursStatus.isOpen && mode === 'notice') {
    const reason = getBusinessHoursReason(businessHoursStatus);
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <div className="shrink-0 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-ink-soft)] text-[12px] flex items-center gap-3">
          <Pause className="h-3.5 w-3.5 text-[var(--color-accent-amber)]" strokeWidth={2} />
          <span className="font-medium text-[var(--color-ink)]">Support is currently closed.</span>
          {businessHoursStatus.nextOpenAt && (
            <span>
              Reopens {formatBusinessHoursTimestamp(businessHoursStatus.nextOpenAt, businessHoursStatus.timezone)}
            </span>
          )}
          {reason && <span>· {reason}</span>}
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
      </div>
    );
  }

  return <>{children}</>;
}

import React from 'react';
import useStore from '../store/useStore';
import { useT } from '../i18n';
import { formatBusinessHoursTimestamp, getBusinessHoursReason } from '../utils/businessHours';

interface BusinessHoursGuardProps {
  children: React.ReactNode;
  mode?: 'block' | 'notice';
}

export default function BusinessHoursGuard({ children, mode = 'block' }: BusinessHoursGuardProps) {
  const { businessHoursStatus, user, memberships, activeMembershipId } = useStore();
  const t = useT();
  const activeMembership = memberships.find((membership) => membership.id === activeMembershipId);
  const partnerName = activeMembership?.partnerName || 'Current workspace';

  if (businessHoursStatus && !businessHoursStatus.isOpen && mode === 'block') {
    return (
      <div className="h-screen bg-white text-black dark:bg-black dark:text-white flex flex-col overflow-hidden" data-testid="business-hours-guard">
        <div className="border-b-2 border-black dark:border-white px-8 py-4 flex items-center justify-between">
          <div className="font-black text-2xl uppercase tracking-tight">Tessera</div>
          <div className="flex items-center gap-3">
            {user && (
              <div className="text-[10px] font-black uppercase tracking-[0.2em] border-2 border-black dark:border-white px-3 py-1">
                {user.name}
              </div>
            )}
            <div className="text-[10px] font-black uppercase tracking-[0.2em] border-2 border-black dark:border-white px-3 py-1">
              {t('support_chat_closed')}
            </div>
          </div>
        </div>
        <div className="flex-1 grid grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] overflow-hidden">
          <div className="border-r-2 border-black dark:border-white px-10 py-10 flex flex-col justify-between">
            <div className="space-y-6">
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60">Logged in as</p>
                <p className="text-lg font-black uppercase tracking-tight">
                  {user?.name || 'Authenticated user'}
                </p>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60">
                  Workspace: {partnerName}
                </p>
              </div>
              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60">Status</p>
                <h1 className="text-5xl font-black uppercase leading-none tracking-tight max-w-3xl">
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
            <div className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50">
              Existing conversations remain available when already open.
            </div>
          </div>
          <div className="px-10 py-10 flex flex-col justify-center">
            <div className="border-2 border-black dark:border-white p-8 space-y-6">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60">Availability</p>
                <p className="mt-3 text-3xl font-black uppercase leading-tight">
                  {businessHoursStatus.nextOpenAt
                    ? `Reopens ${formatBusinessHoursTimestamp(businessHoursStatus.nextOpenAt, businessHoursStatus.timezone)}`
                    : 'Currently closed'}
                </p>
              </div>
              <div className="border-t-2 border-black dark:border-white pt-6 space-y-2 text-sm font-bold">
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
        <div className="shrink-0 px-4 py-2 border-b border-black/10 dark:border-white/10 bg-black text-white dark:bg-white dark:text-black text-xs font-bold">
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

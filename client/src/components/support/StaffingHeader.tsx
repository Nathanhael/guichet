import { useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import { useT, useLang } from '../../i18n';
import { getSocket } from '../../hooks/useSocket';
import SectionLabel from '../ui/SectionLabel';

type StaffingLang = 'nl' | 'fr' | 'en';

interface StaffingHeaderProps {
  partnerId: string;
  filterLang: StaffingLang | null;
  onToggleLang: (lang: StaffingLang | null) => void;
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export default function StaffingHeader({ partnerId, filterLang, onToggleLang }: StaffingHeaderProps) {
  const t = useT();
  const viewerLang = useLang();
  const utils = trpc.useUtils();
  const { data } = trpc.support.getStaffingByLanguage.useQuery(
    { partnerId },
    { refetchInterval: 30_000, staleTime: 15_000 },
  );

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const refetch = () => { utils.support.getStaffingByLanguage.invalidate({ partnerId }); };
    socket.on('presence:change', refetch);
    socket.on('support:online', refetch);
    return () => {
      socket.off('presence:change', refetch);
      socket.off('support:online', refetch);
    };
  }, [utils, partnerId]);

  if (!data || data.length === 0) return null;
  const hasSignal = data.some((r) => r.unclaimedTickets > 0 || r.onlineSupport > 0);
  if (!hasSignal) return null;

  return (
    <div className="px-4 py-3 border-b border-[var(--color-border)]">
      <SectionLabel className="mb-2">{t('queue_staffing_heading')}</SectionLabel>
      <div className="grid grid-cols-3 gap-1.5">
        {data.map((row) => {
          const isActive = filterLang === row.lang;
          const isViewerLang = row.lang === viewerLang;
          const level = row.imbalanceLevel;
          const baseColor =
            level === 'critical' ? 'text-[var(--color-urgent)] border-[var(--color-urgent)]'
            : level === 'thin'   ? 'text-[var(--color-accent-amber)] border-[var(--color-accent-amber)]'
                                 : 'text-[var(--color-ink-muted)] border-[var(--color-border)]';
          const activeClass = isActive
            ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
            : '';
          return (
            <button
              key={row.lang}
              type="button"
              data-staffing-lang={row.lang}
              data-imbalance={level}
              onClick={() => onToggleLang(isActive ? null : row.lang)}
              aria-pressed={isActive}
              title={isViewerLang ? 'Your language' : `Filter queue to ${row.lang.toUpperCase()}`}
              className={`flex flex-col gap-0.5 rounded-[var(--radius-btn)] border px-2 py-1.5 text-left transition-colors hover:opacity-80 ${baseColor} ${activeClass}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold tracking-wide">{row.lang.toUpperCase()}</span>
                {level !== 'ok' && <span aria-hidden="true" className="text-[10px] font-semibold">!</span>}
              </div>
              <span className="text-[10px] font-medium tabular-nums">{interpolate(t('queue_staffing_online'), { n: row.onlineSupport })}</span>
              <span className="text-[10px] font-medium tabular-nums">{interpolate(t('queue_staffing_waiting'), { n: row.unclaimedTickets })}</span>
              {row.oldestWaitMinutes !== null && (
                <span className="text-[10px] font-medium tabular-nums opacity-70">
                  {interpolate(t('queue_staffing_oldest'), { duration: `${row.oldestWaitMinutes}m` })}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

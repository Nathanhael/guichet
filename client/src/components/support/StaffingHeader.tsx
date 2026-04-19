import { useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import { useT, useLang } from '../../i18n';
import { getSocket } from '../../hooks/useSocket';

type StaffingLang = 'nl' | 'fr' | 'en';

interface StaffingHeaderProps {
  partnerId: string;
  filterLang: StaffingLang | null;
  onToggleLang: (lang: StaffingLang | null) => void;
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

/**
 * Per-language staffing card, polled every 30s and refetched on `presence:change`.
 * Critical columns render in accent-red; thin in accent-amber; ok in muted.
 * Click a column to filter the ticket list to that language (toggleable).
 * Hidden when partner has queueLangAwareness=false (endpoint returns empty array).
 */
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
  // Hide entirely when every language has zero waiting AND zero staff
  // (fresh partner, off-hours). Keeps the sidebar clean.
  const hasSignal = data.some((r) => r.unclaimedTickets > 0 || r.onlineSupport > 0);
  if (!hasSignal) return null;

  return (
    <div className="px-4 py-3 border-b border-[var(--color-border)]">
      <div className="mono-label text-[var(--color-text-muted)] mb-2">{t('queue_staffing_heading')}</div>
      <div className="grid grid-cols-3 gap-1.5">
        {data.map((row) => {
          const isActive = filterLang === row.lang;
          const isViewerLang = row.lang === viewerLang;
          const level = row.imbalanceLevel;
          const color =
            level === 'critical' ? 'text-[var(--color-accent-red)] border-[var(--color-accent-red)]'
            : level === 'thin'   ? 'text-[var(--color-accent-amber)] border-[var(--color-accent-amber)]'
                                 : 'text-[var(--color-text-muted)] border-[var(--color-border)]';
          const activeClass = isActive
            ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)] border-[var(--color-text-primary)]'
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
              className={`flex flex-col gap-0.5 border px-2 py-1.5 text-left ${color} ${activeClass} hover:opacity-80`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em]">{row.lang.toUpperCase()}</span>
                {level !== 'ok' && <span aria-hidden="true" className="font-mono text-[9px]">!</span>}
              </div>
              <span className="font-mono text-[9px] tabular-nums">{interpolate(t('queue_staffing_online'), { n: row.onlineSupport })}</span>
              <span className="font-mono text-[9px] tabular-nums">{interpolate(t('queue_staffing_waiting'), { n: row.unclaimedTickets })}</span>
              {row.oldestWaitMinutes !== null && (
                <span className="font-mono text-[9px] tabular-nums opacity-70">
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

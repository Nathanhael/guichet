import { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { useT } from '../../i18n';
import { getStatusColors, getStatusI18nKey } from '../../utils/statusColors';
import GuestBadge from '../GuestBadge';
import SectionLabel from '../ui/SectionLabel';
import type { OnlineSupport } from '../../types';

interface SidebarFooterProps {
  sidebarTab: 'queue' | 'archive';
  onToggleMode?: () => void;
  queueCount: number;
  onlineSupportUsers: OnlineSupport[];
}

const MAX_FOOTER_BADGES = 4;

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function SidebarFooter({ sidebarTab, onToggleMode, queueCount, onlineSupportUsers }: SidebarFooterProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  const availableCount = onlineSupportUsers.filter((u) => u.status === 'online').length;
  const totalOnline = onlineSupportUsers.length;
  const visible = onlineSupportUsers.slice(0, MAX_FOOTER_BADGES);
  const overflow = onlineSupportUsers.slice(MAX_FOOTER_BADGES);

  return (
    <div className="border-t border-[var(--color-border)]">
      {expanded && onlineSupportUsers.length > 0 && (
        <div className="border-b border-[var(--color-border)] px-3 py-3">
          <SectionLabel className="mb-2">{t('online_team')}</SectionLabel>
          <div className="flex flex-col gap-1.5 max-h-[40vh] overflow-y-auto custom-scrollbar pr-1">
            {onlineSupportUsers.map((agent) => {
              const colors = getStatusColors(agent.status);
              return (
                <div key={agent.userId} className="flex items-center gap-2 px-1 py-0.5">
                  <div className="w-6 h-6 rounded-full bg-[var(--color-bg-elevated)] flex items-center justify-center text-[10px] font-semibold text-[var(--color-ink)] shrink-0">
                    {getInitials(agent.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-[var(--color-ink)] truncate flex items-center gap-1.5">
                      <span className="truncate">{agent.name}</span>
                      <GuestBadge isExternal={agent.isExternal} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                    <span className={`text-[11px] font-medium ${colors.text}`}>
                      {t(getStatusI18nKey(agent.status))}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        aria-label={t('toggle_team_panel')}
        aria-expanded={expanded}
        className="w-full px-4 py-2 flex items-center justify-between hover:bg-[var(--color-hover)] cursor-pointer select-none transition-colors"
      >
        <div className="flex items-center gap-2.5">
          {sidebarTab === 'queue' && (
            <span className="text-[11px] font-medium text-[var(--color-ink-muted)]">
              <span className="tabular-nums text-[var(--color-ink-soft)] font-semibold">{queueCount}</span>{' '}
              {t('queued')}
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMode?.();
            }}
            title={sidebarTab === 'queue' ? (t('view_archive') || 'View archive') : (t('view_queue') || 'Back to queue')}
            className="text-[11px] font-semibold rounded-[var(--radius-pill)] px-2 py-0.5 border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white transition-colors"
          >
            {sidebarTab === 'queue' ? t('archive') : t('queue')}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {totalOnline > 0 && (
            <div className="flex items-center">
              {visible.map((agent) => (
                <div
                  key={agent.userId}
                  className="w-5 h-5 rounded-full bg-[var(--color-bg-elevated)] border-[1.5px] border-[var(--color-bg-surface)] flex items-center justify-center text-[8px] font-semibold text-[var(--color-ink-soft)] shrink-0 -ml-1.5 first:ml-0"
                  title={agent.name}
                >
                  {getInitials(agent.name)}
                </div>
              ))}
              {overflow.length > 0 && (
                <div
                  className="w-5 h-5 rounded-full bg-[var(--color-bg-elevated)] border-[1.5px] border-[var(--color-bg-surface)] flex items-center justify-center text-[8px] font-semibold text-[var(--color-ink-muted)] shrink-0 -ml-1.5"
                  title={overflow.map((a) => a.name).join(', ')}
                >
                  +{overflow.length}
                </div>
              )}
            </div>
          )}

          {totalOnline === 0 ? (
            <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--color-ink-muted)]">
              <span className="w-[5px] h-[5px] rounded-full bg-[var(--color-ink-muted)] opacity-60" />
              {t('team_offline')}
            </span>
          ) : (
            <div className="flex items-center gap-1">
              <span
                className={`w-[5px] h-[5px] rounded-full ${
                  availableCount > 0 ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-accent-amber)]'
                }`}
              />
              <span
                className={`text-[11px] font-semibold tabular-nums ${
                  availableCount > 0 ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent-amber)]'
                }`}
              >
                {availableCount} / {totalOnline}
              </span>
            </div>
          )}

          {expanded ? (
            <ChevronDown className="w-3 h-3 text-[var(--color-ink-muted)] shrink-0" strokeWidth={2} />
          ) : (
            <ChevronUp className="w-3 h-3 text-[var(--color-ink-muted)] shrink-0" strokeWidth={2} />
          )}
        </div>
      </div>
    </div>
  );
}

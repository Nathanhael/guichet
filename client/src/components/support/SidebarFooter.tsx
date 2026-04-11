import { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { useT } from '../../i18n';
import { getStatusColors, getStatusI18nKey } from '../../utils/statusColors';
import type { OnlineSupport } from '../../types';

interface SidebarFooterProps {
  sidebarTab: 'queue' | 'archive';
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

export default function SidebarFooter({ sidebarTab, queueCount, onlineSupportUsers }: SidebarFooterProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  const availableCount = onlineSupportUsers.filter((u) => u.status === 'online').length;
  const totalOnline = onlineSupportUsers.length;
  const visible = onlineSupportUsers.slice(0, MAX_FOOTER_BADGES);
  const overflow = onlineSupportUsers.slice(MAX_FOOTER_BADGES);

  return (
    <div className="border-t border-[var(--color-border)]">
      {/* Expanded team panel */}
      {expanded && onlineSupportUsers.length > 0 && (
        <div className="border-b border-[var(--color-border)] px-3 py-3">
          <div className="text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-muted)] mb-2">
            {t('online_team')}
          </div>
          <div className="flex flex-col gap-1.5">
            {onlineSupportUsers.map((agent) => {
              const colors = getStatusColors(agent.status);
              return (
                <div key={agent.userId} className="flex items-center gap-2 px-1 py-0.5">
                  <div className="w-6 h-6 rounded-full bg-[var(--color-bg-elevated)] flex items-center justify-center text-[9px] font-bold text-[var(--color-text-primary)] shrink-0">
                    {getInitials(agent.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold text-[var(--color-text-primary)] truncate">{agent.name}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                    <span className={`text-[9px] font-bold uppercase ${colors.text}`}>
                      {t(getStatusI18nKey(agent.status))}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Collapsed footer bar */}
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-label={t('toggle_team_panel')}
        className="w-full px-4 py-2 flex items-center justify-between hover:bg-[var(--color-bg-elevated)]"
      >
        <span className="font-mono text-[9px] font-medium uppercase tracking-[1px] text-[var(--color-text-muted)]">
          <span className="tabular-nums text-[var(--color-text-secondary)]">{queueCount}</span>{' '}
          {sidebarTab === 'queue' ? t('queued') : t('archived')}
        </span>

        <div className="flex items-center gap-2">
          {/* Agent badges — only when someone is actually online */}
          {totalOnline > 0 && (
            <div className="flex items-center">
              {visible.map((agent) => (
                <div
                  key={agent.userId}
                  className="w-5 h-5 rounded-full bg-[var(--color-bg-elevated)] border-[1.5px] border-[var(--color-bg-surface)] flex items-center justify-center font-mono text-[7px] font-bold text-[var(--color-text-secondary)] shrink-0 -ml-1.5 first:ml-0"
                  title={agent.name}
                >
                  {getInitials(agent.name)}
                </div>
              ))}
              {overflow.length > 0 && (
                <div
                  className="w-5 h-5 rounded-full bg-[var(--color-bg-elevated)] border-[1.5px] border-[var(--color-bg-surface)] flex items-center justify-center font-mono text-[7px] font-bold text-[var(--color-text-muted)] shrink-0 -ml-1.5"
                  title={overflow.map((a) => a.name).join(', ')}
                >
                  +{overflow.length}
                </div>
              )}
            </div>
          )}

          {/* Capacity — color by actual team state:
              - 0 online → muted "OFFLINE" chip (no misleading count)
              - all away → amber dot + count
              - any available → green dot + count */}
          {totalOnline === 0 ? (
            <span className="flex items-center gap-1 font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
              <span className="w-[5px] h-[5px] rounded-full bg-[var(--color-text-muted)] opacity-60" />
              {t('team_offline')}
            </span>
          ) : (
            <div className="flex items-center gap-1">
              <span
                className={`w-[5px] h-[5px] rounded-full ${
                  availableCount > 0 ? 'bg-[var(--color-accent-green)]' : 'bg-[var(--color-accent-amber)]'
                }`}
              />
              <span
                className={`font-mono text-[9px] font-bold tabular-nums ${
                  availableCount > 0 ? 'text-[var(--color-accent-green)]' : 'text-[var(--color-accent-amber)]'
                }`}
              >
                {availableCount} / {totalOnline}
              </span>
            </div>
          )}

          {/* Chevron — make the expand/collapse affordance visible */}
          {expanded ? (
            <ChevronDown className="w-3 h-3 text-[var(--color-text-muted)] opacity-50 shrink-0" />
          ) : (
            <ChevronUp className="w-3 h-3 text-[var(--color-text-muted)] opacity-50 shrink-0" />
          )}
        </div>
      </button>
    </div>
  );
}

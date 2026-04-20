import type { Participant, OnlineSupport } from '../../types';
import useStore from '../../store/useStore';

interface AgentBadgesProps {
  participants: Participant[];
  currentUserId: string;
  maxVisible?: number;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

const STATUS_DOT_COLORS: Record<string, string> = {
  online: 'bg-[var(--color-ok)]',
  away: 'bg-[var(--color-accent-amber)]',
};

export default function AgentBadges({ participants, currentUserId, maxVisible = 4 }: AgentBadgesProps) {
  const onlineSupportUsers = useStore((s) => s.onlineSupportUsers) as OnlineSupport[];

  const statusMap = new Map(onlineSupportUsers.map((u) => [u.userId, u.status]));

  if (participants.length === 0) return null;

  const sorted = [...participants].sort((a, b) => {
    if (a.id === currentUserId) return -1;
    if (b.id === currentUserId) return 1;
    return a.name.localeCompare(b.name);
  });

  const visible = sorted.slice(0, maxVisible);
  const overflow = sorted.slice(maxVisible);

  return (
    <div className="flex items-center">
      {visible.map((agent) => {
        const isSelf = agent.id === currentUserId;
        const tooltip = isSelf ? 'You' : agent.name;
        const status = isSelf ? 'online' : statusMap.get(agent.id);
        const dotColor = status ? STATUS_DOT_COLORS[status] : undefined;
        return (
          <div
            key={agent.id}
            data-self={isSelf || undefined}
            data-tooltip={tooltip}
            role="img"
            aria-label={tooltip}
            className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-semibold shrink-0 -ml-1.5 first:ml-0 border-[1.5px] border-[var(--color-bg-surface)] relative group cursor-default ${
              isSelf
                ? 'bg-[var(--color-accent)] text-white'
                : 'bg-[var(--color-bg-elevated)] text-[var(--color-ink-soft)]'
            }`}
          >
            <span>{getInitials(agent.name)}</span>
            {dotColor && (
              <span
                data-presence-dot
                className={`absolute -bottom-px -right-px w-2 h-2 rounded-full border-[1.5px] border-[var(--color-bg-surface)] ${dotColor}`}
              />
            )}
            <span className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)] px-2 py-1 text-[11px] font-medium text-[var(--color-ink)] whitespace-nowrap z-10">
              {tooltip}
            </span>
          </div>
        );
      })}
      {overflow.length > 0 && (
        <div
          data-tooltip={overflow.map((a) => a.name).join(', ')}
          className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-semibold shrink-0 -ml-1.5 bg-[var(--color-bg-elevated)] text-[var(--color-ink-muted)] border-[1.5px] border-[var(--color-bg-surface)] relative group cursor-default"
        >
          <span>+{overflow.length}</span>
          <span className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)] px-2 py-1 text-[11px] font-medium text-[var(--color-ink)] whitespace-nowrap z-10">
            {overflow.map((a) => a.name).join(', ')}
          </span>
        </div>
      )}
    </div>
  );
}

import type { Participant } from '../../types';

interface AgentBadgesProps {
  participants: Participant[];
  currentUserId: string;
  maxVisible?: number;
}

/** Extract up to 2 initials from a name. */
function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Overlapping monogram badges showing which support agents have joined a ticket.
 * - Current user: blue background, "You" tooltip
 * - Others: elevated background, full name tooltip
 * - Overflow: "+N" badge with remaining names on hover
 */
export default function AgentBadges({ participants, currentUserId, maxVisible = 4 }: AgentBadgesProps) {
  // ticket.participants only contains support staff who joined — the end-user
  // is tracked separately via ticket.agentId/agentName, never in this array.
  // No role filtering needed.
  if (participants.length === 0) return null;

  // Current user first, then alphabetical
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
        return (
          <div
            key={agent.id}
            data-self={isSelf || undefined}
            data-tooltip={tooltip}
            role="img"
            aria-label={tooltip}
            className={`w-5 h-5 rounded-full flex items-center justify-center font-mono text-[7px] font-bold shrink-0 -ml-1.5 first:ml-0 border-[1.5px] border-[var(--color-bg-surface)] relative group cursor-default ${
              isSelf
                ? 'bg-[var(--color-accent-blue)] text-white'
                : 'bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]'
            }`}
          >
            <span>{getInitials(agent.name)}</span>
            <span className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-[var(--color-bg-base)] border border-[var(--color-border-heavy)] px-2 py-1 font-mono text-[9px] font-medium text-[var(--color-text-primary)] whitespace-nowrap z-10">
              {tooltip}
            </span>
          </div>
        );
      })}
      {overflow.length > 0 && (
        <div
          data-tooltip={overflow.map((a) => a.name).join(', ')}
          className="w-5 h-5 rounded-full flex items-center justify-center font-mono text-[7px] font-bold shrink-0 -ml-1.5 bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] border-[1.5px] border-[var(--color-bg-surface)] relative group cursor-default"
        >
          <span>+{overflow.length}</span>
          <span className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-[var(--color-bg-base)] border border-[var(--color-border-heavy)] px-2 py-1 font-mono text-[9px] font-medium text-[var(--color-text-primary)] whitespace-nowrap z-10">
            {overflow.map((a) => a.name).join(', ')}
          </span>
        </div>
      )}
    </div>
  );
}

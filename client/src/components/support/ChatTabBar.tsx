import { X } from 'lucide-react';
import { useT } from '../../i18n';
import useStore from '../../store/useStore';
import { Ticket } from '../../types';
import { MAX_OPEN_CHATS } from '../../config';
import ViewModeDropdown from './ViewModeDropdown';

interface ChatTabBarProps {
  tabs: Ticket[];
  activeTab: string | null;
  onSelectTab: (ticketId: string) => void;
  onCloseTab: (ticketId: string) => void;
}

export default function ChatTabBar({ tabs, activeTab, onSelectTab, onCloseTab }: ChatTabBarProps) {
  const t = useT();
  const unreadTickets = useStore((s) => s.unreadTickets);

  if (tabs.length === 0) {
    return (
      <div className="border-b border-[var(--color-border)] px-4 py-3">
        <span className="text-[12px] text-[var(--color-ink-muted)]">
          {t('no_active_chats')}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center border-b border-[var(--color-border)] overflow-x-auto">
      {tabs.map((ticket) => {
        const isActive = activeTab === ticket.id;
        const hasUnread = !isActive && !!unreadTickets[ticket.id];

        return (
          <div
            key={ticket.id}
            className={`flex items-center border-r border-[var(--color-border)] transition-colors ${
              isActive
                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-hover)]'
            }`}
          >
            <button
              onClick={() => onSelectTab(ticket.id)}
              className="pl-4 pr-2 py-3 text-[12px] font-semibold flex items-center gap-2"
              title={ticket.agentName ?? undefined}
            >
              {ticket.agentName || t('unknown')}
              {hasUnread && (
                <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] shrink-0" />
              )}
            </button>
            <button
              onClick={() => onCloseTab(ticket.id)}
              aria-label={`${t('close')} ${ticket.agentName}`}
              className="pr-3 py-3 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        );
      })}
      <div className="ml-auto flex items-center gap-2 px-3 shrink-0">
        <ViewModeDropdown />
        <span className="text-[11px] font-medium text-[var(--color-ink-muted)] tabular-nums">
          {tabs.length}/{MAX_OPEN_CHATS}
        </span>
      </div>
    </div>
  );
}

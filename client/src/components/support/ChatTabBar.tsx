import { useT } from '../../i18n';
import useStore from '../../store/useStore';
import { Ticket } from '../../types';
import { MAX_OPEN_CHATS } from '../../config';

interface ChatTabBarProps {
  tabs: Ticket[];
  activeTab: string | null;
  onSelectTab: (ticketId: string) => void;
  onCloseTab: (ticketId: string) => void;
}

/**
 * Horizontal tab strip showing all open support chat sessions.
 * Each tab shows agent name, unread badge, and a close button.
 */
export default function ChatTabBar({ tabs, activeTab, onSelectTab, onCloseTab }: ChatTabBarProps) {
  const t = useT();
  const unreadTickets = useStore((s) => s.unreadTickets);

  if (tabs.length === 0) {
    return (
      <div className="border-b border-[var(--color-border)] px-4 py-2">
        <span className="mono-label opacity-30">
          {t('no_active_chats') || 'No active chats'}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center border-b border-[var(--color-border)] overflow-x-auto">
      {tabs.map((ticket) => {
        const isActive = activeTab === ticket.id;
        const hasUnread = !isActive && unreadTickets.has(ticket.id);

        return (
          <div
            key={ticket.id}
            className={`flex items-center border-r border-[var(--color-border)] ${
              isActive ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)]' : ''
            }`}
          >
            <button
              onClick={() => onSelectTab(ticket.id)}
              className="px-6 py-3 text-[10px] font-bold uppercase tracking-wide flex items-center gap-2"
              title={ticket.agentName}
            >
              {ticket.agentName || t('unknown')}
              {hasUnread && (
                <span className="w-2 h-2 rounded-full bg-[var(--color-accent-blue)] shrink-0" />
              )}
            </button>
            <button
              onClick={() => onCloseTab(ticket.id)}
              aria-label={`${t('close')} ${ticket.agentName}`}
              className="pr-3 py-3 text-[10px] font-bold opacity-60 hover:opacity-100"
            >
              ×
            </button>
          </div>
        );
      })}
      {/* Tab capacity indicator */}
      <span className="ml-auto px-4 text-[9px] font-bold uppercase tracking-wide opacity-30 shrink-0">
        {tabs.length}/{MAX_OPEN_CHATS}
      </span>
    </div>
  );
}

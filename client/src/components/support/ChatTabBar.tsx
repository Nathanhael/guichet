import { useT } from '../../i18n';
import { Ticket } from '../../types';

interface ChatTabBarProps {
  tabs: Ticket[];
  activeTab: string | null;
  onSelectTab: (ticketId: string) => void;
  onCloseTab: (ticketId: string) => void;
}

/**
 * Horizontal tab strip showing all open support chat sessions.
 * Each tab shows agent name and a separate close button.
 */
export default function ChatTabBar({ tabs, activeTab, onSelectTab, onCloseTab }: ChatTabBarProps) {
  const t = useT();

  if (tabs.length === 0) return null;

  return (
    <div className="flex border-b-2 border-black dark:border-white overflow-x-auto">
      {tabs.map((ticket) => {
        const isActive = activeTab === ticket.id;

        return (
          <div
            key={ticket.id}
            className={`flex items-center border-r-2 border-black dark:border-white ${
              isActive ? 'bg-black dark:bg-white text-white dark:text-black' : ''
            }`}
          >
            <button
              onClick={() => onSelectTab(ticket.id)}
              className="px-6 py-3 text-[10px] font-black uppercase tracking-widest"
            >
              {ticket.agentName}
            </button>
            <button
              onClick={() => onCloseTab(ticket.id)}
              aria-label={`${t('close')} ${ticket.agentName}`}
              className="pr-3 py-3 text-[10px] font-black opacity-60 hover:opacity-100"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

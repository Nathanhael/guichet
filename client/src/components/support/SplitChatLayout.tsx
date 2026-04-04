import { Ticket } from '../../types';
import ChatWindow from '../ChatWindow';

interface SplitChatLayoutProps {
  tabs: Ticket[];
  activeTab: string | null;
  onSelectTab: (ticketId: string) => void;
  onCloseTab: (ticketId: string) => void;
}

/**
 * Arranges 2-4 ChatWindows based on count:
 * - 2 chats: equal 50/50 columns
 * - 3 chats: primary (50%) + 2 secondary (25% each)
 * - 4 chats: 2x2 grid
 */
export default function SplitChatLayout({ tabs, activeTab, onSelectTab, onCloseTab }: SplitChatLayoutProps) {
  if (tabs.length === 0) return null;

  // 2x2 grid for 4 chats
  if (tabs.length === 4) {
    return (
      <div className="grid grid-cols-2 grid-rows-2 flex-1 overflow-hidden">
        {tabs.map((ticket) => (
          <div
            key={ticket.id}
            onClick={() => onSelectTab(ticket.id)}
            className={`border border-border overflow-hidden flex flex-col ${
              ticket.id === activeTab ? 'border-l-[3px] border-l-accent-blue' : ''
            }`}
          >
            <ChatWindow ticket={ticket} compact onClose={() => onCloseTab(ticket.id)} />
          </div>
        ))}
      </div>
    );
  }

  // 3 chats: primary (50%) + 2 secondary (25% each)
  if (tabs.length === 3) {
    const primaryId = activeTab && tabs.find((t) => t.id === activeTab) ? activeTab : tabs[0].id;
    const primary = tabs.find((t) => t.id === primaryId)!;
    const secondaries = tabs.filter((t) => t.id !== primaryId);

    return (
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-[2] border-r border-border-heavy overflow-hidden flex flex-col border-l-[3px] border-l-accent-blue">
          <ChatWindow ticket={primary} compact onClose={() => onCloseTab(primary.id)} />
        </div>
        <div className="flex-[1] flex flex-col overflow-hidden">
          {secondaries.map((ticket, i) => (
            <div
              key={ticket.id}
              onClick={() => onSelectTab(ticket.id)}
              className={`flex-1 overflow-hidden flex flex-col cursor-pointer hover:bg-bg-elevated ${
                i < secondaries.length - 1 ? 'border-b border-border-heavy' : ''
              }`}
            >
              <ChatWindow ticket={ticket} compact onClose={() => onCloseTab(ticket.id)} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 2 chats: equal 50/50
  return (
    <div className="flex flex-1 overflow-hidden">
      {tabs.map((ticket, i) => (
        <div
          key={ticket.id}
          onClick={() => onSelectTab(ticket.id)}
          className={`flex-1 overflow-hidden flex flex-col ${
            i < tabs.length - 1 ? 'border-r border-border-heavy' : ''
          } ${ticket.id === activeTab ? 'border-l-[3px] border-l-accent-blue' : ''}`}
        >
          <ChatWindow ticket={ticket} compact onClose={() => onCloseTab(ticket.id)} />
        </div>
      ))}
    </div>
  );
}

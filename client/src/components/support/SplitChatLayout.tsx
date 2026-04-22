import { Ticket } from '../../types';
import type { ViewMode } from '../../store/slices/uiSlice';
import ChatWindow from '../ChatWindow';

interface SplitChatLayoutProps {
  tabs: Ticket[];
  activeTab: string | null;
  viewMode: ViewMode;
  onSelectTab: (ticketId: string) => void;
  onCloseTab: (ticketId: string) => void;
}

export default function SplitChatLayout({ tabs, activeTab, viewMode, onSelectTab, onCloseTab }: SplitChatLayoutProps) {
  if (tabs.length === 0) return null;

  const isActive = (id: string) => id === activeTab;

  // Each chat becomes a mini-card with shadow + radius; gap-3 between cards
  // provides the visual channel. Active chat gets a 2px accent ring that
  // reads on all sides (replaces the old left-only border stripe).
  const cardClass = (active: boolean) =>
    `overflow-hidden flex flex-col min-w-0 transition-all duration-150 rounded-[var(--radius-card)] shadow-[var(--shadow-card)] ${
      active ? 'ring-2 ring-[var(--color-accent)]' : ''
    }`;

  if (viewMode === 'split-stack') {
    return (
      <div className="flex h-full overflow-hidden gap-3 p-3">
        {tabs.map((ticket) => (
          <div
            key={ticket.id}
            onClick={() => onSelectTab(ticket.id)}
            style={{ flex: isActive(ticket.id) ? 2 : 1 }}
            className={cardClass(isActive(ticket.id))}
          >
            <ChatWindow ticket={ticket} compact={!isActive(ticket.id)} onClose={() => onCloseTab(ticket.id)} />
          </div>
        ))}
      </div>
    );
  }

  const topRow = tabs.slice(0, 2);
  const bottomRow = tabs.slice(2, 4);

  return (
    <div className="flex flex-col h-full overflow-hidden gap-3 p-3">
      <div className="flex flex-1 overflow-hidden min-h-0 gap-3">
        {topRow.map((ticket) => (
          <div
            key={ticket.id}
            onClick={() => onSelectTab(ticket.id)}
            style={{ flex: isActive(ticket.id) ? 2 : 1 }}
            className={cardClass(isActive(ticket.id))}
          >
            <ChatWindow ticket={ticket} compact={!isActive(ticket.id)} onClose={() => onCloseTab(ticket.id)} />
          </div>
        ))}
      </div>

      {bottomRow.length > 0 && (
        <div className="flex flex-1 overflow-hidden min-h-0 gap-3">
          {bottomRow.map((ticket) => (
            <div
              key={ticket.id}
              onClick={() => onSelectTab(ticket.id)}
              style={{ flex: isActive(ticket.id) ? 2 : 1 }}
              className={cardClass(isActive(ticket.id))}
            >
              <ChatWindow ticket={ticket} compact={!isActive(ticket.id)} onClose={() => onCloseTab(ticket.id)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

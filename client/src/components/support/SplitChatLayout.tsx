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

  if (viewMode === 'split-stack') {
    return (
      <div className="flex h-full overflow-hidden">
        {tabs.map((ticket, i) => (
          <div
            key={ticket.id}
            onClick={() => onSelectTab(ticket.id)}
            style={{ flex: isActive(ticket.id) ? 2 : 1 }}
            className={`overflow-hidden flex flex-col min-w-0 transition-[flex] duration-150 ${
              i < tabs.length - 1 ? 'border-r border-[var(--color-border)]' : ''
            } ${isActive(ticket.id) ? 'border-l-[3px] border-l-[var(--color-accent)]' : ''}`}
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
    <div className="flex flex-col h-full overflow-hidden">
      <div className={`flex ${bottomRow.length > 0 ? 'flex-1' : 'flex-1'} overflow-hidden min-h-0 ${
        bottomRow.length > 0 ? 'border-b border-[var(--color-border)]' : ''
      }`}>
        {topRow.map((ticket, ci) => (
          <div
            key={ticket.id}
            onClick={() => onSelectTab(ticket.id)}
            style={{ flex: isActive(ticket.id) ? 2 : 1 }}
            className={`overflow-hidden flex flex-col min-w-0 transition-[flex] duration-150 ${
              ci === 0 && topRow.length > 1 ? 'border-r border-[var(--color-border)]' : ''
            } ${isActive(ticket.id) ? 'border-l-[3px] border-l-[var(--color-accent)]' : ''}`}
          >
            <ChatWindow ticket={ticket} compact={!isActive(ticket.id)} onClose={() => onCloseTab(ticket.id)} />
          </div>
        ))}
      </div>

      {bottomRow.length > 0 && (
        <div className="flex flex-1 overflow-hidden min-h-0">
          {bottomRow.map((ticket, ci) => (
            <div
              key={ticket.id}
              onClick={() => onSelectTab(ticket.id)}
              style={{ flex: isActive(ticket.id) ? 2 : 1 }}
              className={`overflow-hidden flex flex-col min-w-0 transition-[flex] duration-150 ${
                ci === 0 && bottomRow.length > 1 ? 'border-r border-[var(--color-border)]' : ''
              } ${isActive(ticket.id) ? 'border-l-[3px] border-l-[var(--color-accent)]' : ''}`}
            >
              <ChatWindow ticket={ticket} compact={!isActive(ticket.id)} onClose={() => onCloseTab(ticket.id)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

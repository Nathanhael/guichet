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

/**
 * Arranges 2-4 ChatWindows in two layouts:
 *
 * split-grid  — 2x2 grid (falls back to columns for 2-3 tabs)
 * split-stack — all panels side-by-side as columns
 *
 * In both modes the active/selected panel is larger than the rest.
 */
export default function SplitChatLayout({ tabs, activeTab, viewMode, onSelectTab, onCloseTab }: SplitChatLayoutProps) {
  if (tabs.length === 0) return null;

  const isActive = (id: string) => id === activeTab;

  // ── split-stack: horizontal columns, active panel wider ──
  if (viewMode === 'split-stack') {
    return (
      <div className="flex h-full overflow-hidden">
        {tabs.map((ticket, i) => (
          <div
            key={ticket.id}
            onClick={() => onSelectTab(ticket.id)}
            style={{ flex: isActive(ticket.id) ? 2 : 1 }}
            className={`overflow-hidden flex flex-col min-w-0 transition-[flex] duration-150 ${
              i < tabs.length - 1 ? 'border-r border-border-heavy' : ''
            } ${isActive(ticket.id) ? 'border-l-[3px] border-l-accent-blue' : ''}`}
          >
            <ChatWindow ticket={ticket} compact={!isActive(ticket.id)} onClose={() => onCloseTab(ticket.id)} />
          </div>
        ))}
      </div>
    );
  }

  // ── split-grid: 2x2 grid, graceful degradation for 1-3 tabs ──
  // 4 tabs: 2 top + 2 bottom
  // 3 tabs: 2 top + 1 spanning bottom
  // 2 tabs: top row side-by-side, no bottom row
  // 1 tab:  full screen

  const topRow = tabs.slice(0, 2);
  const bottomRow = tabs.slice(2, 4);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top row */}
      <div className={`flex ${bottomRow.length > 0 ? 'flex-1' : 'flex-1'} overflow-hidden min-h-0 ${
        bottomRow.length > 0 ? 'border-b border-border-heavy' : ''
      }`}>
        {topRow.map((ticket, ci) => (
          <div
            key={ticket.id}
            onClick={() => onSelectTab(ticket.id)}
            style={{ flex: isActive(ticket.id) ? 2 : 1 }}
            className={`overflow-hidden flex flex-col min-w-0 transition-[flex] duration-150 ${
              ci === 0 && topRow.length > 1 ? 'border-r border-border-heavy' : ''
            } ${isActive(ticket.id) ? 'border-l-[3px] border-l-accent-blue' : ''}`}
          >
            <ChatWindow ticket={ticket} compact={!isActive(ticket.id)} onClose={() => onCloseTab(ticket.id)} />
          </div>
        ))}
      </div>

      {/* Bottom row — spans full width when only 1 tab */}
      {bottomRow.length > 0 && (
        <div className="flex flex-1 overflow-hidden min-h-0">
          {bottomRow.map((ticket, ci) => (
            <div
              key={ticket.id}
              onClick={() => onSelectTab(ticket.id)}
              style={{ flex: isActive(ticket.id) ? 2 : 1 }}
              className={`overflow-hidden flex flex-col min-w-0 transition-[flex] duration-150 ${
                ci === 0 && bottomRow.length > 1 ? 'border-r border-border-heavy' : ''
              } ${isActive(ticket.id) ? 'border-l-[3px] border-l-accent-blue' : ''}`}
            >
              <ChatWindow ticket={ticket} compact={!isActive(ticket.id)} onClose={() => onCloseTab(ticket.id)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

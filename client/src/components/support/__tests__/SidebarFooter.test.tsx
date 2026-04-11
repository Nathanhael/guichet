import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SidebarFooter from '../SidebarFooter';
import type { OnlineSupport } from '../../../types';

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

const agents: OnlineSupport[] = [
  { userId: 'u1', name: 'Alice Reeves', status: 'online' },
  { userId: 'u2', name: 'Bob Chen', status: 'online' },
  { userId: 'u3', name: 'Charlie Davis', status: 'away' },
  { userId: 'u4', name: 'Diana Evans', status: 'online' },
];

describe('SidebarFooter', () => {
  it('shows queue count on queue tab', () => {
    render(<SidebarFooter sidebarTab="queue" queueCount={9} onlineSupportUsers={agents} />);
    expect(screen.getByText(/9/)).toBeInTheDocument();
    // Sidebar footer now uses the 'queued' i18n key (renamed from the
    // missing 'in_queue' key). Matches either the translated string or
    // the raw key fallback.
    expect(screen.getByText(/queued/i)).toBeInTheDocument();
  });

  it('shows archive count on archive tab', () => {
    render(<SidebarFooter sidebarTab="archive" queueCount={7} onlineSupportUsers={agents} />);
    expect(screen.getByText(/7/)).toBeInTheDocument();
  });

  it('shows capacity count', () => {
    render(<SidebarFooter sidebarTab="queue" queueCount={5} onlineSupportUsers={agents} />);
    expect(screen.getByText('3 / 4')).toBeInTheDocument();
  });

  it('shows agent badges (max 4 visible)', () => {
    render(<SidebarFooter sidebarTab="queue" queueCount={5} onlineSupportUsers={agents} />);
    expect(screen.getByText('AR')).toBeInTheDocument();
    expect(screen.getByText('BC')).toBeInTheDocument();
  });

  it('shows +N overflow when more than 4 agents', () => {
    const many: OnlineSupport[] = [
      ...agents,
      { userId: 'u5', name: 'Eve Franklin', status: 'online' },
      { userId: 'u6', name: 'Frank Garcia', status: 'away' },
    ];
    render(<SidebarFooter sidebarTab="queue" queueCount={5} onlineSupportUsers={many} />);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('expands team panel on click', () => {
    render(<SidebarFooter sidebarTab="queue" queueCount={5} onlineSupportUsers={agents} />);
    expect(screen.queryByText('online_team')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /toggle_team_panel/i }));
    expect(screen.getByText('online_team')).toBeInTheDocument();
    expect(screen.getByText('Alice Reeves')).toBeInTheDocument();
    expect(screen.getByText('Charlie Davis')).toBeInTheDocument();
  });

  it('collapses team panel on second click', () => {
    render(<SidebarFooter sidebarTab="queue" queueCount={5} onlineSupportUsers={agents} />);
    const toggle = screen.getByRole('button', { name: /toggle_team_panel/i });
    fireEvent.click(toggle);
    expect(screen.getByText('online_team')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByText('online_team')).not.toBeInTheDocument();
  });
});

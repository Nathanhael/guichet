import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QueueTicketRow from '../QueueTicketRow';
import useStore from '../../../store/useStore';
import type { Ticket } from '../../../types';

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
  useLang: () => 'en',
}));

const baseTicket: Ticket = {
  id: 'ticket-1',
  dept: 'BIL',
  agentId: 'agent-1',
  agentName: 'Kelvin Ferry-Okuneva',
  agentLang: 'en',
  status: 'open',
  createdAt: '2026-04-05T09:15:00Z',
  participants: [
    { id: 'support-1', name: 'Alice Reeves', role: 'support' },
  ],
  labels: [],
};

beforeEach(() => {
  useStore.setState({ onlineSupportUsers: [{ userId: 'support-1', name: 'Alice Reeves', status: 'online' }] });
});

describe('QueueTicketRow', () => {
  it('renders agent name in normal case', () => {
    render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={0} currentUserId="support-1" variant="mine" onClick={() => {}} />
    );
    expect(screen.getByText('Kelvin Ferry-Okuneva')).toBeInTheDocument();
  });

  it('renders department badge', () => {
    render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={0} currentUserId="support-1" variant="mine" onClick={() => {}} />
    );
    expect(screen.getByText('BIL')).toBeInTheDocument();
  });

  it('does not render the row-level status dot', () => {
    const { container } = render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={0} currentUserId="support-1" variant="mine" onClick={() => {}} />
    );
    expect(container.querySelector('[data-status-dot]')).toBeNull();
  });

  it('hides participants who are not in the online presence list', () => {
    useStore.setState({ onlineSupportUsers: [] });
    const ticket = {
      ...baseTicket,
      participants: [
        { id: 'support-1', name: 'Alice Reeves', role: 'support' as const },
        { id: 'support-2', name: 'Bob Carter', role: 'support' as const },
      ],
    };
    render(
      <QueueTicketRow ticket={ticket} isActive={false} unreadCount={0} currentUserId="other-user" variant="queue" onClick={() => {}} />
    );
    expect(screen.queryByText('AR')).toBeNull();
    expect(screen.queryByText('BC')).toBeNull();
  });

  it('always keeps the current user even when missing from onlineSupportUsers (race-safe)', () => {
    useStore.setState({ onlineSupportUsers: [] });
    render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={0} currentUserId="support-1" variant="mine" onClick={() => {}} />
    );
    expect(screen.getByText('AR')).toBeInTheDocument();
  });

  it('shows online participants and hides offline ones in the same ticket', () => {
    useStore.setState({ onlineSupportUsers: [{ userId: 'support-1', name: 'Alice Reeves', status: 'online' }] });
    const ticket = {
      ...baseTicket,
      participants: [
        { id: 'support-1', name: 'Alice Reeves', role: 'support' as const },
        { id: 'support-2', name: 'Bob Carter', role: 'support' as const },
      ],
    };
    render(
      <QueueTicketRow ticket={ticket} isActive={false} unreadCount={0} currentUserId="other-user" variant="other" onClick={() => {}} />
    );
    expect(screen.getByText('AR')).toBeInTheDocument();
    expect(screen.queryByText('BC')).toBeNull();
  });

  it('shows unread count badge when unreadCount > 0', () => {
    render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={3} currentUserId="support-1" variant="mine" onClick={() => {}} />
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('does not show unread badge when unreadCount is 0', () => {
    render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={0} currentUserId="support-1" variant="mine" onClick={() => {}} />
    );
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('applies active styling when isActive', () => {
    const { container } = render(
      <QueueTicketRow ticket={baseTicket} isActive={true} unreadCount={0} currentUserId="support-1" variant="mine" onClick={() => {}} />
    );
    expect((container.firstChild as HTMLElement)?.className).toContain('border-l-[var(--color-accent)]');
  });

  it('applies unread tint when unreadCount > 0', () => {
    const { container } = render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={2} currentUserId="support-1" variant="mine" onClick={() => {}} />
    );
    expect((container.firstChild as HTMLElement)?.className).toContain('bg-[var(--color-accent-soft)]');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={0} currentUserId="support-1" variant="mine" onClick={onClick} />
    );
    fireEvent.click(screen.getByText('Kelvin Ferry-Okuneva'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows disabled state when disabled', () => {
    const { container } = render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={0} currentUserId="support-1" variant="mine" onClick={() => {}} disabled={true} />
    );
    expect((container.firstChild as HTMLElement)?.className).toContain('opacity-40');
  });

  it('renders agent badges for support participants', () => {
    render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={0} currentUserId="support-1" variant="mine" onClick={() => {}} />
    );
    expect(screen.getByText('AR')).toBeInTheDocument();
  });

  it('shows green dot when customer (agent) is online', () => {
    useStore.setState({ onlineAgentIds: ['agent-1'] });
    const { container } = render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={0} currentUserId="support-1" variant="mine" onClick={() => {}} />
    );
    const dot = container.querySelector('[data-agent-online]');
    expect(dot).toBeInTheDocument();
    expect(dot?.className).toContain('bg-[var(--color-ok)]');
  });

  it('hides customer dot when agent is offline', () => {
    useStore.setState({ onlineAgentIds: [] });
    const { container } = render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={0} currentUserId="support-1" variant="mine" onClick={() => {}} />
    );
    expect(container.querySelector('[data-agent-online]')).toBeNull();
  });

  it('hides customer dot when a different agent is online', () => {
    useStore.setState({ onlineAgentIds: ['other-agent'] });
    const { container } = render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={0} currentUserId="support-1" variant="mine" onClick={() => {}} />
    );
    expect(container.querySelector('[data-agent-online]')).toBeNull();
  });
});

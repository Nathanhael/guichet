import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QueueTicketRow from '../QueueTicketRow';
import type { Ticket } from '../../../types';

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
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

describe('QueueTicketRow', () => {
  it('renders agent name in normal case', () => {
    render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={0} currentUserId="support-1" onClick={() => {}} />
    );
    expect(screen.getByText('Kelvin Ferry-Okuneva')).toBeInTheDocument();
  });

  it('renders department badge', () => {
    render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={0} currentUserId="support-1" onClick={() => {}} />
    );
    expect(screen.getByText('BIL')).toBeInTheDocument();
  });

  it('renders status dot with open class', () => {
    const { container } = render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={0} currentUserId="support-1" onClick={() => {}} />
    );
    const dot = container.querySelector('[data-status-dot]');
    expect(dot?.className).toContain('bg-[var(--color-accent-green)]');
  });

  it('renders pending status dot', () => {
    const pendingTicket = { ...baseTicket, status: 'pending' as const };
    const { container } = render(
      <QueueTicketRow ticket={pendingTicket} isActive={false} unreadCount={0} currentUserId="support-1" onClick={() => {}} />
    );
    const dot = container.querySelector('[data-status-dot]');
    expect(dot?.className).toContain('bg-[var(--color-accent-purple)]');
  });

  it('shows unread count badge when unreadCount > 0', () => {
    render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={3} currentUserId="support-1" onClick={() => {}} />
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('does not show unread badge when unreadCount is 0', () => {
    render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={0} currentUserId="support-1" onClick={() => {}} />
    );
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('applies active styling when isActive', () => {
    const { container } = render(
      <QueueTicketRow ticket={baseTicket} isActive={true} unreadCount={0} currentUserId="support-1" onClick={() => {}} />
    );
    expect(container.firstChild?.className).toContain('border-l-[var(--color-accent-blue)]');
  });

  it('applies unread tint when unreadCount > 0', () => {
    const { container } = render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={2} currentUserId="support-1" onClick={() => {}} />
    );
    expect(container.firstChild?.className).toContain('bg-[rgba(59,130,246,0.04)]');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={0} currentUserId="support-1" onClick={onClick} />
    );
    fireEvent.click(screen.getByText('Kelvin Ferry-Okuneva'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows disabled state when disabled', () => {
    const { container } = render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={0} currentUserId="support-1" onClick={() => {}} disabled={true} />
    );
    expect(container.firstChild?.className).toContain('opacity-40');
  });

  it('renders agent badges for support participants', () => {
    render(
      <QueueTicketRow ticket={baseTicket} isActive={false} unreadCount={0} currentUserId="support-1" onClick={() => {}} />
    );
    expect(screen.getByText('AR')).toBeInTheDocument();
  });
});

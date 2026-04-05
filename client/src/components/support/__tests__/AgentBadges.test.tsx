import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentBadges from '../AgentBadges';
import type { Participant } from '../../../types';

const participants: Participant[] = [
  { id: 'user-1', name: 'Alice Reeves', role: 'support' },
  { id: 'user-2', name: 'Bob Chen', role: 'support' },
  { id: 'user-3', name: 'Charlie Davis', role: 'agent' },
];

describe('AgentBadges', () => {
  it('renders monograms for support-like participants only', () => {
    render(<AgentBadges participants={participants} currentUserId="user-99" />);
    expect(screen.getByText('AR')).toBeInTheDocument();
    expect(screen.getByText('BC')).toBeInTheDocument();
    expect(screen.queryByText('CD')).not.toBeInTheDocument();
  });

  it('renders current user badge with "You" tooltip', () => {
    render(<AgentBadges participants={participants} currentUserId="user-1" />);
    const badge = screen.getByText('AR');
    expect(badge.closest('[data-self]')).toBeInTheDocument();
  });

  it('current user appears first', () => {
    render(<AgentBadges participants={participants} currentUserId="user-2" />);
    const badges = screen.getAllByRole('img', { hidden: true });
    expect(badges[0]).toHaveAttribute('aria-label', 'You');
  });

  it('renders nothing when no support participants', () => {
    const agentOnly: Participant[] = [
      { id: 'user-3', name: 'Charlie Davis', role: 'agent' },
    ];
    const { container } = render(<AgentBadges participants={agentOnly} currentUserId="user-99" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows overflow count when maxVisible exceeded', () => {
    const many: Participant[] = [
      { id: 'u1', name: 'Alice A', role: 'support' },
      { id: 'u2', name: 'Bob B', role: 'support' },
      { id: 'u3', name: 'Charlie C', role: 'support' },
      { id: 'u4', name: 'Diana D', role: 'support' },
      { id: 'u5', name: 'Eve E', role: 'support' },
      { id: 'u6', name: 'Frank F', role: 'admin' },
    ];
    render(<AgentBadges participants={many} currentUserId="u99" maxVisible={4} />);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('shows tooltip text on hover', () => {
    render(<AgentBadges participants={participants} currentUserId="user-99" />);
    const badge = screen.getByText('AR');
    expect(badge.closest('[data-tooltip]')?.getAttribute('data-tooltip')).toBe('Alice Reeves');
  });
});

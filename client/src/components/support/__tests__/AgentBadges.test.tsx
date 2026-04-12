import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentBadges from '../AgentBadges';
import useStore from '../../../store/useStore';
import type { Participant } from '../../../types';

// Real participant data has no role field — only { id, name }
const participants: Participant[] = [
  { id: 'user-1', name: 'Alice Reeves' },
  { id: 'user-2', name: 'Bob Chen' },
];

beforeEach(() => {
  useStore.setState({
    onlineSupportUsers: [
      { userId: 'user-1', name: 'Alice Reeves', status: 'online' },
      { userId: 'user-2', name: 'Bob Chen', status: 'online' },
    ],
  });
});

describe('AgentBadges', () => {
  it('renders monograms for all participants', () => {
    render(<AgentBadges participants={participants} currentUserId="user-99" />);
    expect(screen.getByText('AR')).toBeInTheDocument();
    expect(screen.getByText('BC')).toBeInTheDocument();
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

  it('renders nothing when participants is empty', () => {
    const { container } = render(<AgentBadges participants={[]} currentUserId="user-99" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows overflow count when maxVisible exceeded', () => {
    const many: Participant[] = [
      { id: 'u1', name: 'Alice A' },
      { id: 'u2', name: 'Bob B' },
      { id: 'u3', name: 'Charlie C' },
      { id: 'u4', name: 'Diana D' },
      { id: 'u5', name: 'Eve E' },
      { id: 'u6', name: 'Frank F' },
    ];
    render(<AgentBadges participants={many} currentUserId="u99" maxVisible={4} />);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('shows tooltip text on hover', () => {
    render(<AgentBadges participants={participants} currentUserId="user-99" />);
    const badge = screen.getByText('AR');
    expect(badge.closest('[data-tooltip]')?.getAttribute('data-tooltip')).toBe('Alice Reeves');
  });

  it('renders green presence dot for online support', () => {
    useStore.setState({ onlineSupportUsers: [{ userId: 'user-1', name: 'Alice Reeves', status: 'online' }] });
    const { container } = render(<AgentBadges participants={[participants[0]]} currentUserId="other" />);
    const dot = container.querySelector('[data-presence-dot]');
    expect(dot).toBeInTheDocument();
    expect(dot?.className).toContain('accent-green');
  });

  it('renders amber presence dot for away support', () => {
    useStore.setState({ onlineSupportUsers: [{ userId: 'user-1', name: 'Alice Reeves', status: 'away' }] });
    const { container } = render(<AgentBadges participants={[participants[0]]} currentUserId="other" />);
    const dot = container.querySelector('[data-presence-dot]');
    expect(dot).toBeInTheDocument();
    expect(dot?.className).toContain('accent-amber');
  });

  it('always shows green dot for self (current user)', () => {
    useStore.setState({ onlineSupportUsers: [] });
    const { container } = render(<AgentBadges participants={[participants[0]]} currentUserId="user-1" />);
    const dot = container.querySelector('[data-presence-dot]');
    expect(dot).toBeInTheDocument();
    expect(dot?.className).toContain('accent-green');
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Avatar from '../Avatar';

describe('Avatar', () => {
  it('derives two-letter initials from the name', () => {
    render(<Avatar name="Lucas Support" data-testid="av" />);
    expect(screen.getByTestId('av')).toHaveTextContent('LS');
  });

  it('uses the first two letters for single-word names', () => {
    render(<Avatar name="Jo" data-testid="av" />);
    expect(screen.getByTestId('av')).toHaveTextContent('JO');
  });

  it('produces the same background color for the same name', () => {
    const { rerender } = render(<Avatar name="Lucas Support" data-testid="av" />);
    const first = screen.getByTestId('av').getAttribute('style');
    rerender(<Avatar name="Lucas Support" data-testid="av" />);
    const second = screen.getByTestId('av').getAttribute('style');
    expect(first).toBe(second);
    expect(first).toMatch(/background: /);
  });

  it('renders an image instead of initials when src is set', () => {
    render(<Avatar name="Zara" src="/logos/acme.png" alt="Acme" />);
    const img = screen.getByRole('img', { name: 'Acme' });
    expect(img).toHaveAttribute('src', '/logos/acme.png');
    // No initials letter node when an image takes the slot
    expect(screen.queryByText('ZA')).toBeNull();
  });

  it('renders a status dot when statusDot is set', () => {
    const { container } = render(<Avatar name="Zara" statusDot="online" data-testid="av" />);
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect((dot as HTMLElement).style.background).toContain('var(--color-ok)');
  });

  it('omits the status dot when statusDot is null', () => {
    const { container } = render(<Avatar name="Zara" statusDot={null} />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('honors custom size and shape', () => {
    render(<Avatar name="Zara" size={44} shape="squircle" data-testid="av" />);
    const el = screen.getByTestId('av');
    expect(el.style.width).toBe('44px');
    expect(el.style.height).toBe('44px');
    expect(el.style.borderRadius).toBe('8px');
  });
});

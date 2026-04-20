import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import GuestBadge from '../GuestBadge';

/* ------------------------------------------------------------------ */
/*  i18n stub — map keys to their fallback English strings             */
/* ------------------------------------------------------------------ */

vi.mock('../../i18n', () => ({
  useT: () => (key: string) => {
    const dict: Record<string, string> = {
      guest_badge: 'GUEST',
      guest_badge_tooltip: 'External partner guest (B2B) — limited admin permissions.',
      guest_badge_aria: 'External guest user',
    };
    return dict[key] ?? '';
  },
}));

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('GuestBadge', () => {
  it('renders nothing when isExternal is undefined', () => {
    const { container } = render(<GuestBadge />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when isExternal is false', () => {
    const { container } = render(<GuestBadge isExternal={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the GUEST label when isExternal is true', () => {
    render(<GuestBadge isExternal />);
    expect(screen.getByTestId('guest-badge')).toHaveTextContent('GUEST');
  });

  it('exposes the tooltip title for screen readers and mouse hover', () => {
    render(<GuestBadge isExternal />);
    const el = screen.getByTestId('guest-badge');
    expect(el).toHaveAttribute('title', expect.stringContaining('External'));
    expect(el).toHaveAttribute('aria-label', 'External guest user');
  });

  it('uses the compact inline class set by default', () => {
    render(<GuestBadge isExternal />);
    const el = screen.getByTestId('guest-badge');
    expect(el.className).toContain('text-[10px]');
    expect(el.className).toContain('px-1.5');
  });

  it('uses the prominent class set when size="prominent"', () => {
    render(<GuestBadge isExternal size="prominent" />);
    const el = screen.getByTestId('guest-badge');
    expect(el.className).toContain('text-[11px]');
    expect(el.className).toContain('px-2');
  });

  it('appends caller-supplied className', () => {
    render(<GuestBadge isExternal className="ml-2" />);
    const el = screen.getByTestId('guest-badge');
    expect(el.className).toContain('ml-2');
  });

  it('applies soft-product amber pill palette (amber border + amber text + rounded pill)', () => {
    render(<GuestBadge isExternal />);
    const el = screen.getByTestId('guest-badge');
    expect(el.className).toContain('border-[var(--color-accent-amber)]');
    expect(el.className).toContain('text-[var(--color-accent-amber)]');
    expect(el.className).toContain('rounded-[var(--radius-pill)]');
    expect(el.className).toContain('font-semibold');
    // Soft product: Inter default, not mono, not uppercase
    expect(el.className).not.toContain('font-mono');
    expect(el.className).not.toContain('uppercase');
  });
});

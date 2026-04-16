import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SupportNav from '../SupportNav';
import useStore from '../../../store/useStore';

/**
 * Covers the clickable Ctrl+K palette-trigger button. The button is a no-prop
 * affordance that dispatches a `support:open-palette` window event — the
 * parent view listens for it and opens the palette. This keeps the nav free
 * of prop-drilling.
 */
describe('SupportNav — Ctrl+K badge', () => {
  beforeEach(() => {
    // Seed a minimal user so SupportNav renders (returns null without one).
    useStore.setState({
      user: { id: 'u1', email: 'a@b.c', name: 'Tester', lang: 'en' } as never,
      focusMode: false,
      onlineSupportUsers: [],
    });
  });

  it('dispatches support:open-palette when the Ctrl+K button is clicked', () => {
    const handler = vi.fn();
    window.addEventListener('support:open-palette', handler);

    render(<SupportNav partnerName="Acme" />);
    fireEvent.click(screen.getByRole('button', { name: /command palette/i }));

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener('support:open-palette', handler);
  });

  it('hides the Ctrl+K button when focus mode is enabled', () => {
    useStore.setState({ focusMode: true });
    render(<SupportNav partnerName="Acme" />);
    expect(screen.queryByRole('button', { name: /command palette/i })).not.toBeInTheDocument();
  });
});

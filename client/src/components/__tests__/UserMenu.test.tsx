import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import UserMenu from '../UserMenu';

/* ------------------------------------------------------------------ */
/*  Store mock                                                          */
/* ------------------------------------------------------------------ */

const mockLogout = vi.fn();

vi.mock('../../store/useStore', () => ({
  default: (selector: (s: { user: { id: string; name: string; email: string }; logout: () => void }) => unknown) =>
    selector({
      user: { id: 'u1', name: 'Amelie Rousseau', email: 'amelie@acme.com' },
      logout: mockLogout,
    }),
}));

/* ------------------------------------------------------------------ */
/*  i18n mock — returns the key itself                                 */
/* ------------------------------------------------------------------ */

vi.mock('../../i18n', () => ({
  useT: () => (key: string) => key,
}));

/* ------------------------------------------------------------------ */
/*  UserSecurityModal mock                                             */
/* ------------------------------------------------------------------ */

vi.mock('../UserSecurityModal', () => ({
  default: () => <div data-testid="user-security-modal" />,
}));

/* ------------------------------------------------------------------ */
/*  Tests                                                               */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  mockLogout.mockClear();
});

describe('UserMenu', () => {
  it('renders avatar button with "AR" initials', () => {
    render(<UserMenu />);
    const btn = screen.getByRole('button', { name: 'user_menu' });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent('AR');
  });

  it('opens dropdown showing name, email, and sign_out', () => {
    render(<UserMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'user_menu' }));
    expect(screen.getByText('Amelie Rousseau')).toBeInTheDocument();
    expect(screen.getByText('amelie@acme.com')).toBeInTheDocument();
    expect(screen.getByText('sign_out')).toBeInTheDocument();
  });

  it('shows feedback button when showFeedback=true and calls onFeedback', () => {
    const onFeedback = vi.fn();
    render(<UserMenu showFeedback onFeedback={onFeedback} />);
    fireEvent.click(screen.getByRole('button', { name: 'user_menu' }));
    const feedbackBtn = screen.getByText('feedback');
    expect(feedbackBtn).toBeInTheDocument();
    fireEvent.click(feedbackBtn);
    expect(onFeedback).toHaveBeenCalledTimes(1);
  });

  it('hides feedback button by default', () => {
    render(<UserMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'user_menu' }));
    expect(screen.queryByText('feedback')).not.toBeInTheDocument();
  });

  it('shows account_security button when showSecurity=true', () => {
    render(<UserMenu showSecurity />);
    fireEvent.click(screen.getByRole('button', { name: 'user_menu' }));
    expect(screen.getByText('account_security')).toBeInTheDocument();
  });

  it('closes dropdown on outside click', () => {
    render(
      <div>
        <div data-testid="outside">outside</div>
        <UserMenu />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'user_menu' }));
    expect(screen.getByText('sign_out')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('sign_out')).not.toBeInTheDocument();
  });
});

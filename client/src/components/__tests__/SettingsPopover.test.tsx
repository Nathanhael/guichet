import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SettingsPopover from '../SettingsPopover';

/* ------------------------------------------------------------------ */
/*  Child component mocks                                               */
/* ------------------------------------------------------------------ */

vi.mock('../LanguageSwitcher', () => ({
  default: () => <div data-testid="language-switcher" />,
}));

vi.mock('../DarkModeToggle', () => ({
  default: () => <div data-testid="dark-mode-toggle" />,
}));

vi.mock('../NotificationToggle', () => ({
  default: () => <div data-testid="notification-toggle" />,
}));

vi.mock('../../store/useStore', () => ({
  useStoreShallow: () => ({
    dyslexicMode: false,
    toggleDyslexicMode: vi.fn(),
    bionicReading: false,
    toggleBionicReading: vi.fn(),
    monochromeMode: false,
    toggleMonochromeMode: vi.fn(),
  }),
}));

vi.mock('../support/ViewModeDropdown', () => ({
  default: () => <div data-testid="view-mode-dropdown" />,
}));

/* ------------------------------------------------------------------ */
/*  i18n mock — returns the key itself                                 */
/* ------------------------------------------------------------------ */

vi.mock('../../i18n', () => ({
  useT: () => (key: string) => key,
}));


/* ------------------------------------------------------------------ */
/*  Tests                                                               */
/* ------------------------------------------------------------------ */

describe('SettingsPopover', () => {

  it('renders gear button with settings aria-label', () => {
    render(<SettingsPopover />);
    const btn = screen.getByRole('button', { name: 'settings' });
    expect(btn).toBeInTheDocument();
  });

  it('popover is closed by default', () => {
    render(<SettingsPopover />);
    expect(screen.queryByTestId('language-switcher')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dark-mode-toggle')).not.toBeInTheDocument();
  });

  it('opens popover on gear click and always shows language + dark mode', () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole('button', { name: 'settings' }));
    expect(screen.getByTestId('language-switcher')).toBeInTheDocument();
    expect(screen.getByTestId('dark-mode-toggle')).toBeInTheDocument();
  });

  it('closes popover on second gear click', () => {
    render(<SettingsPopover />);
    const btn = screen.getByRole('button', { name: 'settings' });
    fireEvent.click(btn);
    expect(screen.getByTestId('language-switcher')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByTestId('language-switcher')).not.toBeInTheDocument();
  });

  it('does not show optional items by default', () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole('button', { name: 'settings' }));
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByTestId('notification-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('view-mode-dropdown')).not.toBeInTheDocument();
  });

  it('shows accessibility toggles when showAccessibility=true', () => {
    render(<SettingsPopover showAccessibility />);
    fireEvent.click(screen.getByRole('button', { name: 'settings' }));
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(3);
  });

  it('shows notifications when showNotifications=true', () => {
    render(<SettingsPopover showNotifications />);
    fireEvent.click(screen.getByRole('button', { name: 'settings' }));
    expect(screen.getByTestId('notification-toggle')).toBeInTheDocument();
  });

  it('shows view mode dropdown when showViewMode=true', () => {
    render(<SettingsPopover showViewMode />);
    fireEvent.click(screen.getByRole('button', { name: 'settings' }));
    expect(screen.getByTestId('view-mode-dropdown')).toBeInTheDocument();
  });

  it('closes on outside click (mousedown on document.body)', () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole('button', { name: 'settings' }));
    expect(screen.getByTestId('language-switcher')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('language-switcher')).not.toBeInTheDocument();
  });

  it('closes on Escape key', () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole('button', { name: 'settings' }));
    expect(screen.getByTestId('language-switcher')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('language-switcher')).not.toBeInTheDocument();
  });

  it('all optional items visible when all flags enabled', () => {
    render(
      <SettingsPopover
        showAccessibility
        showNotifications
        showViewMode
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'settings' }));
    expect(screen.getByTestId('language-switcher')).toBeInTheDocument();
    expect(screen.getByTestId('dark-mode-toggle')).toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(3);
    expect(screen.getByTestId('notification-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('view-mode-dropdown')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlatformView from '../PlatformView';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockLogout = vi.hoisted(() => vi.fn());

vi.mock('../../store/useStore', () => {
  const state = { logout: mockLogout, token: 'test' };
  const store = (selector?: (s: typeof state) => unknown) => selector ? selector(state) : state;
  store.getState = () => state;
  return { default: store, useStoreShallow: (selector: (s: typeof state) => unknown) => selector(state) };
});

vi.mock('../../i18n', () => ({
  useT: () => (key: string) => key,
}));

const mockSecurityStatus = { mfaEnabled: true, mfaPending: false, stepUpSatisfied: true, stepUpExpiresAt: null };

vi.mock('../../utils/trpc', () => ({
  trpc: {
    platformSecurity: {
      getStatus: {
        useQuery: () => ({ data: mockSecurityStatus }),
      },
    },
  },
}));

// Mock all child components to isolate PlatformView shell logic
vi.mock('../../components/DarkModeToggle', () => ({
  default: () => <div data-testid="dark-mode-toggle" />,
}));

vi.mock('../../components/LanguageSwitcher', () => ({
  default: () => <div data-testid="language-switcher" />,
}));

vi.mock('../../components/SettingsPopover', () => ({
  default: () => <div data-testid="settings-popover" />,
}));

vi.mock('../../components/UserMenu', () => ({
  default: () => <div data-testid="user-menu" />,
}));

vi.mock('../../components/admin/PlatformSystemHealth', () => ({
  default: () => <div data-testid="system-health" />,
}));

vi.mock('../../components/admin/PlatformAuditLog', () => ({
  default: () => <div data-testid="audit-log" />,
}));

vi.mock('../../components/admin/PlatformSecurityOps', () => ({
  default: () => <div data-testid="security-ops" />,
}));

vi.mock('../../components/admin/PlatformSystemSettings', () => ({
  default: () => <div data-testid="system-settings" />,
}));

vi.mock('../../components/platform/PartnerList', () => ({
  default: ({ onCreateClick }: { onCreateClick: () => void }) => (
    <div data-testid="partner-list">
      <button onClick={onCreateClick}>mock-create</button>
    </div>
  ),
}));

vi.mock('../../components/platform/UserTable', () => ({
  default: ({ onInviteClick }: { onInviteClick: () => void }) => (
    <div data-testid="user-table">
      <button onClick={onInviteClick}>mock-invite</button>
    </div>
  ),
}));

vi.mock('../../components/platform/CreatePartnerModal', () => ({
  default: ({ open }: { open: boolean }) => open ? <div data-testid="create-partner-modal" /> : null,
}));

vi.mock('../../components/platform/EditPartnerModal', () => ({
  default: () => null,
}));

vi.mock('../../components/platform/DeletePartnerModal', () => ({
  default: () => null,
}));

vi.mock('../../components/platform/InviteUserModal', () => ({
  default: ({ open }: { open: boolean }) => open ? <div data-testid="invite-user-modal" /> : null,
}));

vi.mock('../../components/platform/ManageAccessModal', () => ({
  default: () => null,
}));

vi.mock('../../components/platform/EditUserProfileModal', () => ({
  default: () => null,
}));

vi.mock('../../components/admin/PlatformArchiveViewer', () => ({
  default: () => <div data-testid="archive-viewer" />,
}));

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('PlatformView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nav bar with TESSERA brand and platform badge', () => {
    render(<PlatformView />);
    expect(screen.getByText('TESSERA')).toBeInTheDocument();
    expect(screen.getByText('platform')).toBeInTheDocument();
  });

  it('renders all platform tab buttons', () => {
    render(<PlatformView />);
    expect(screen.getByText('partners_tab')).toBeInTheDocument();
    expect(screen.getByText('users_tab')).toBeInTheDocument();
    expect(screen.getByText('security_tab')).toBeInTheDocument();
    expect(screen.getByText('health_tab')).toBeInTheDocument();
    expect(screen.getByText('config_tab')).toBeInTheDocument();
    expect(screen.getByText('audit_tab')).toBeInTheDocument();
    expect(screen.getByText('archive_tab')).toBeInTheDocument();
  });

  it('shows PartnerList by default (partners tab)', () => {
    render(<PlatformView />);
    expect(screen.getByTestId('partner-list')).toBeInTheDocument();
  });

  it('switches to UserTable when users tab is clicked', () => {
    render(<PlatformView />);
    fireEvent.click(screen.getByText('users_tab'));
    expect(screen.getByTestId('user-table')).toBeInTheDocument();
    expect(screen.queryByTestId('partner-list')).not.toBeInTheDocument();
  });

  it('switches to health tab', () => {
    render(<PlatformView />);
    fireEvent.click(screen.getByText('health_tab'));
    expect(screen.getByTestId('system-health')).toBeInTheDocument();
  });

  it('switches to config tab', () => {
    render(<PlatformView />);
    fireEvent.click(screen.getByText('config_tab'));
    expect(screen.getByTestId('system-settings')).toBeInTheDocument();
  });

  it('switches to audit tab', () => {
    render(<PlatformView />);
    fireEvent.click(screen.getByText('audit_tab'));
    expect(screen.getByTestId('audit-log')).toBeInTheDocument();
  });

  it('renders user menu in nav bar', () => {
    render(<PlatformView />);
    expect(screen.getByTestId('user-menu')).toBeInTheDocument();
  });

  it('opens CreatePartnerModal when PartnerList triggers create', () => {
    render(<PlatformView />);
    expect(screen.queryByTestId('create-partner-modal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('mock-create'));
    expect(screen.getByTestId('create-partner-modal')).toBeInTheDocument();
  });

  it('opens InviteUserModal when UserTable triggers invite', () => {
    render(<PlatformView />);
    fireEvent.click(screen.getByText('users_tab'));
    expect(screen.queryByTestId('invite-user-modal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('mock-invite'));
    expect(screen.getByTestId('invite-user-modal')).toBeInTheDocument();
  });

  it('switches to archive tab', () => {
    render(<PlatformView />);
    fireEvent.click(screen.getByText('archive_tab'));
    expect(screen.getByTestId('archive-viewer')).toBeInTheDocument();
  });

  it('switches to security tab', () => {
    render(<PlatformView />);
    fireEvent.click(screen.getByText('security_tab'));
    expect(screen.getByTestId('security-ops')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import UserTable from '../UserTable';
import type { GlobalUser, Partner } from '../types';

const { mockRevokeSessions, activeUser, pendingUser, deletedUser, partner } = vi.hoisted(() => {
  const activeUser: GlobalUser = {
    id: 'u1', name: 'Alice', email: 'alice@example.com',
    isPlatformOperator: false, deletedAt: null,
    lastActiveAt: '2025-06-01T12:00:00Z', externalId: 'ext-1',
    partnerMemberships: [{ id: 'm1', partnerId: 'p1', partnerName: 'Acme', role: 'admin', source: 'manual' }],
  };
  const pendingUser: GlobalUser = {
    id: 'u2', name: 'Bob', email: 'bob@example.com',
    isPlatformOperator: false, deletedAt: null,
    lastActiveAt: null, externalId: null,
    partnerMemberships: [{ id: 'm2', partnerId: 'p1', partnerName: 'Acme', role: 'support', source: 'manual' }],
  };
  const deletedUser: GlobalUser = {
    id: 'u3', name: 'Deleted', email: 'del@example.com',
    isPlatformOperator: false, deletedAt: '2025-01-01T00:00:00Z',
    lastActiveAt: null, externalId: null, partnerMemberships: [],
  };
  const partner: Partner = {
    id: 'p1', name: 'Acme', industry: 'Tech',
    status: 'active', createdAt: '', updatedAt: '',
  };
  return {
    mockRevokeSessions: { mutate: vi.fn(), isPending: false },
    activeUser, pendingUser, deletedUser, partner,
  };
});

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../../../utils/trpc', () => ({
  trpc: {
    platform: {
      listGlobalUsers: {
        useQuery: () => ({ data: { users: [activeUser, pendingUser, deletedUser], nextCursor: '' }, isLoading: false }),
      },
      listPartners: {
        useQuery: () => ({ data: [partner], isLoading: false }),
      },
    },
    user: {
      revokeSessions: {
        useMutation: (opts: { onSuccess?: () => void; onError?: (err: Error) => void }) => {
          mockRevokeSessions.mutate.mockImplementation(() => opts.onSuccess?.());
          return mockRevokeSessions;
        },
      },
    },
  },
}));

describe('UserTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderComponent() {
    return render(<UserTable />);
  }

  it('renders active users, hides deleted users', () => {
    renderComponent();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText('Deleted')).not.toBeInTheDocument();
  });

  it('renders table headers', () => {
    renderComponent();
    expect(screen.getByText('col_name')).toBeInTheDocument();
    expect(screen.getByText('email_identity')).toBeInTheDocument();
    expect(screen.getByText('col_status')).toBeInTheDocument();
    expect(screen.getByText('col_actions')).toBeInTheDocument();
  });

  it('does not render an invite button (provisioning is Azure-managed)', () => {
    renderComponent();
    expect(screen.queryByText('invite_new_user')).not.toBeInTheDocument();
  });

  it('does not render a delete account button (Azure manages account lifecycle)', () => {
    renderComponent();
    expect(screen.queryByText('delete_account')).not.toBeInTheDocument();
  });

  it('does not render a manage access button (memberships shown read-only in the access scope column)', () => {
    renderComponent();
    expect(screen.queryByText('manage_access')).not.toBeInTheDocument();
  });

  it('shows pending status for users without lastActiveAt', () => {
    renderComponent();
    expect(screen.getByText('status_pending')).toBeInTheDocument();
  });

  it('shows linked-sso status for users with an externalId', () => {
    renderComponent();
    expect(screen.getByText('status_linked_sso')).toBeInTheDocument();
  });

  it('filters users by search input', () => {
    renderComponent();
    const searchInput = screen.getByPlaceholderText('search_users_placeholder');
    fireEvent.change(searchInput, { target: { value: 'alice' } });

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
  });

  it('shows clear button when search has value and clears on click', () => {
    renderComponent();
    const searchInput = screen.getByPlaceholderText('search_users_placeholder');
    expect(screen.queryByLabelText('clear')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'test' } });
    expect(screen.getByLabelText('clear')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('clear'));
    expect(searchInput).toHaveValue('');
  });

  it('shows revoke sessions confirmation when revoke sessions is clicked', () => {
    renderComponent();
    const revokeButtons = screen.getAllByText('Revoke Sessions');
    fireEvent.click(revokeButtons[0]);
    expect(screen.getByText(/Force sign-out all active sessions/)).toBeInTheDocument();
  });

  it('hides revoke sessions for pending users (no externalId)', () => {
    // Pending invites have no sessions to revoke; the button is meaningless
    // until the user claims via SSO. With one claimed user (Alice) and one
    // pending user (Bob) in the fixture set, only one button should render.
    renderComponent();
    const revokeButtons = screen.getAllByText('Revoke Sessions');
    expect(revokeButtons).toHaveLength(1);
  });

  it('shows partner membership badges', () => {
    renderComponent();
    expect(screen.getAllByText('Acme').length).toBeGreaterThan(0);
  });
});

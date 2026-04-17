import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import UserTable from '../UserTable';
import type { GlobalUser, Partner } from '../types';

const { mockDeleteUser, mockResendInvite, mockRevokeSessions, mockDisableMfa, mockUnlockUser, activeUser, pendingUser, deletedUser, partner } = vi.hoisted(() => {
  const activeUser: GlobalUser = {
    id: 'u1', name: 'Alice', email: 'alice@example.com',
    isPlatformOperator: false, deletedAt: null,
    lastActiveAt: '2025-06-01T12:00:00Z', externalId: null,
    partnerMemberships: [{ id: 'm1', partnerId: 'p1', partnerName: 'Acme', role: 'admin' }],
  };
  const pendingUser: GlobalUser = {
    id: 'u2', name: 'Bob', email: 'bob@example.com',
    isPlatformOperator: false, deletedAt: null,
    lastActiveAt: null, externalId: null,
    partnerMemberships: [{ id: 'm2', partnerId: 'p1', partnerName: 'Acme', role: 'support' }],
  };
  const deletedUser: GlobalUser = {
    id: 'u3', name: 'Deleted', email: 'del@example.com',
    isPlatformOperator: false, deletedAt: '2025-01-01T00:00:00Z',
    lastActiveAt: null, externalId: null, partnerMemberships: [],
  };
  const partner: Partner = {
    id: 'p1', name: 'Acme', logoUrl: null, industry: 'Tech',
    status: 'active', createdAt: '', updatedAt: '',
  };
  return {
    mockDeleteUser: { mutate: vi.fn(), isPending: false },
    mockResendInvite: { mutate: vi.fn(), isPending: false },
    mockRevokeSessions: { mutate: vi.fn(), isPending: false },
    mockDisableMfa: { mutate: vi.fn(), isPending: false },
    mockUnlockUser: { mutate: vi.fn(), isPending: false },
    activeUser, pendingUser, deletedUser, partner,
  };
});

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../../../utils/trpc', () => ({
  trpc: {
    useUtils: () => ({
      platform: {
        listPartners: { invalidate: vi.fn() },
        listGlobalUsers: { invalidate: vi.fn() },
      },
    }),
    platform: {
      listGlobalUsers: {
        useQuery: () => ({ data: { users: [activeUser, pendingUser, deletedUser], nextCursor: '' }, isLoading: false }),
      },
      listPartners: {
        useQuery: () => ({ data: [partner], isLoading: false }),
      },
      deleteUser: {
        useMutation: (opts: { onSuccess?: () => void }) => {
          mockDeleteUser.mutate.mockImplementation(() => opts.onSuccess?.());
          return mockDeleteUser;
        },
      },
      resendInvite: {
        useMutation: (opts: { onSuccess?: () => void; onError?: (err: Error) => void }) => {
          mockResendInvite.mutate.mockImplementation(() => opts.onSuccess?.());
          return mockResendInvite;
        },
      },
      disableUserMfa: {
        useMutation: (opts: { onSuccess?: () => void; onError?: (err: Error) => void }) => {
          mockDisableMfa.mutate.mockImplementation(() => opts.onSuccess?.());
          return mockDisableMfa;
        },
      },
      unlockUser: {
        useMutation: (opts: { onSuccess?: () => void; onError?: (err: Error) => void }) => {
          mockUnlockUser.mutate.mockImplementation(() => opts.onSuccess?.());
          return mockUnlockUser;
        },
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
  const onInviteClick = vi.fn();
  const onEditProfile = vi.fn();
  const onManageAccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderComponent() {
    return render(
      <UserTable
        onInviteClick={onInviteClick}
        onEditProfile={onEditProfile}
        onManageAccess={onManageAccess}
      />
    );
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

  it('calls onInviteClick when invite button is clicked', () => {
    renderComponent();
    fireEvent.click(screen.getByText('invite_new_user'));
    expect(onInviteClick).toHaveBeenCalledTimes(1);
  });

  it('calls onEditProfile when edit profile button is clicked', () => {
    renderComponent();
    const editButtons = screen.getAllByText('edit_profile');
    fireEvent.click(editButtons[0]);
    expect(onEditProfile).toHaveBeenCalledWith(activeUser);
  });

  it('calls onManageAccess when manage access button is clicked', () => {
    renderComponent();
    const accessButtons = screen.getAllByText('manage_access');
    fireEvent.click(accessButtons[0]);
    expect(onManageAccess).toHaveBeenCalledWith(activeUser);
  });

  it('shows pending status for users without lastActiveAt', () => {
    renderComponent();
    expect(screen.getByText('status_pending')).toBeInTheDocument();
  });

  it('shows active status for users with lastActiveAt', () => {
    renderComponent();
    expect(screen.getByText('status_active_local')).toBeInTheDocument();
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
    expect(screen.queryByText('clear')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'test' } });
    expect(screen.getByText('clear')).toBeInTheDocument();

    fireEvent.click(screen.getByText('clear'));
    expect(searchInput).toHaveValue('');
  });

  it('shows resend invite button for pending users', () => {
    renderComponent();
    expect(screen.getByText('resend_invite')).toBeInTheDocument();
  });

  it('shows delete confirmation when delete is clicked', () => {
    renderComponent();
    const deleteButtons = screen.getAllByText('delete_account');
    fireEvent.click(deleteButtons[0]);
    expect(screen.getByText(/confirm_delete_account/)).toBeInTheDocument();
  });

  it('shows revoke sessions confirmation when revoke sessions is clicked', () => {
    renderComponent();
    const revokeButtons = screen.getAllByText('Revoke Sessions');
    fireEvent.click(revokeButtons[0]);
    expect(screen.getByText(/Force sign-out all active sessions/)).toBeInTheDocument();
  });

  it('shows partner membership badges', () => {
    renderComponent();
    expect(screen.getAllByText('Acme').length).toBeGreaterThan(0);
  });
});

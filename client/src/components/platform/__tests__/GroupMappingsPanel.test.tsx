import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GroupMappingsPanel from '../GroupMappingsPanel';

/* ------------------------------------------------------------------ */
/*  Hoisted mocks                                                      */
/* ------------------------------------------------------------------ */

const { mockRemoveMutate, mockMappings, mockPartners } = vi.hoisted(() => {
  return {
    mockRemoveMutate: vi.fn(),
    mockMappings: [
      {
        id: 'gm-1',
        partnerId: 'p1',
        partnerName: 'Acme Corp',
        azureGroupId: 'group-uuid-1',
        azureGroupName: 'Acme-Support',
        defaultRole: 'support',
        defaultDepartments: [],
      },
    ],
    mockPartners: [
      { id: 'p1', name: 'Acme Corp', status: 'active', authMethod: 'sso', departments: [], deletedAt: null },
    ],
  };
});

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../../../utils/roles', () => ({
  getRoleDisplayName: (role: string) => role.toUpperCase(),
}));

vi.mock('../../Toast', () => ({
  default: () => null,
}));

vi.mock('../../ConfirmDialog', () => ({
  default: ({ title, message, onConfirm, onCancel }: { title: string; message: string; onConfirm: () => void; onCancel: () => void }) => (
    <div data-testid="confirm-dialog">
      <span>{title}</span>
      <span>{message}</span>
      <button onClick={onConfirm}>confirm</button>
      <button onClick={onCancel}>cancel</button>
    </div>
  ),
}));

vi.mock('../../../utils/trpc', () => ({
  trpc: {
    useUtils: () => ({
      platform: {
        listGroupMappings: { invalidate: vi.fn() },
      },
    }),
    platform: {
      listGroupMappings: {
        useQuery: () => ({ data: mockMappings, isLoading: false }),
      },
      listPartners: {
        useQuery: () => ({ data: mockPartners }),
      },
      removeGroupMapping: {
        useMutation: (opts?: { onSuccess?: () => void; onError?: (err: Error) => void }) => ({
          mutate: (...args: unknown[]) => { mockRemoveMutate(...args); opts?.onSuccess?.(); },
          isPending: false,
        }),
      },
      addGroupMapping: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      updateGroupMapping: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('GroupMappingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders SSO group mappings table with data', () => {
    render(<GroupMappingsPanel />);
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Acme-Support')).toBeInTheDocument();
    expect(screen.getByText('group-uuid-1')).toBeInTheDocument();
  });

  it('shows ConfirmDialog when remove button is clicked (not native confirm)', () => {
    render(<GroupMappingsPanel />);
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('remove'));
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
  });

  it('ConfirmDialog cancel closes without calling mutation', () => {
    render(<GroupMappingsPanel />);
    fireEvent.click(screen.getByText('remove'));
    fireEvent.click(screen.getByText('cancel'));
    expect(mockRemoveMutate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it('ConfirmDialog confirm calls removeMutation with mapping ID', () => {
    render(<GroupMappingsPanel />);
    fireEvent.click(screen.getByText('remove'));
    fireEvent.click(screen.getByText('confirm'));
    expect(mockRemoveMutate).toHaveBeenCalledWith('gm-1');
  });

  it('renders add mapping button', () => {
    render(<GroupMappingsPanel />);
    expect(screen.getByText('add_mapping')).toBeInTheDocument();
  });
});

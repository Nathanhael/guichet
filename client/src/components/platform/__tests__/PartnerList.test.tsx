import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PartnerList from '../PartnerList';
import type { Partner } from '../types';

/* ------------------------------------------------------------------ */
/*  Hoisted mocks (vi.mock factories can only use hoisted values)      */
/* ------------------------------------------------------------------ */

const { mockDeactivate, mockReactivate, activePartner, inactivePartner } = vi.hoisted(() => {
  const activePartner: Partner = {
    id: 'p1', name: 'Acme Corp', logoUrl: null, industry: 'Tech',
    status: 'active', createdAt: '', updatedAt: '',
  };
  const inactivePartner: Partner = {
    id: 'p2', name: 'Old Inc', logoUrl: null, industry: 'Tech',
    status: 'inactive', createdAt: '', updatedAt: '',
  };
  return {
    mockDeactivate: { mutate: vi.fn(), isPending: false },
    mockReactivate: { mutate: vi.fn(), isPending: false },
    activePartner,
    inactivePartner,
  };
});

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../../../store/useStore', () => {
  const store = () => ({ token: 'test', enterPartnerAsOperator: vi.fn() });
  store.getState = () => ({ token: 'test', enterPartnerAsOperator: vi.fn() });
  return { default: store };
});

vi.mock('../../../utils/trpc', () => ({
  trpc: {
    useUtils: () => ({
      platform: {
        listPartners: { invalidate: vi.fn() },
        listGlobalUsers: { invalidate: vi.fn() },
      },
    }),
    platform: {
      listPartners: {
        useQuery: () => ({ data: [activePartner, inactivePartner], isLoading: false }),
      },
      deactivatePartner: { useMutation: (opts: { onSuccess?: () => void }) => {
        mockDeactivate.mutate.mockImplementation(() => opts.onSuccess?.());
        return mockDeactivate;
      }},
      reactivatePartner: { useMutation: (opts: { onSuccess?: () => void }) => {
        mockReactivate.mutate.mockImplementation(() => opts.onSuccess?.());
        return mockReactivate;
      }},
    },
  },
}));

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('PartnerList', () => {
  const onCreateClick = vi.fn();
  const onEditPartner = vi.fn();
  const onDeletePartner = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderComponent() {
    return render(
      <PartnerList
        onCreateClick={onCreateClick}
        onEditPartner={onEditPartner}
        onDeletePartner={onDeletePartner}
      />
    );
  }

  it('renders active and inactive partner sections', () => {
    renderComponent();
    expect(screen.getByText('active_partners')).toBeInTheDocument();
    expect(screen.getByText('inactive_partners')).toBeInTheDocument();
  });

  it('renders partner names', () => {
    renderComponent();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Old Inc')).toBeInTheDocument();
  });

  it('calls onCreateClick when "Create New Partner" button is clicked', () => {
    renderComponent();
    fireEvent.click(screen.getByText('create_new_partner'));
    expect(onCreateClick).toHaveBeenCalledTimes(1);
  });

  it('calls onEditPartner when configure button is clicked', () => {
    renderComponent();
    const configureButtons = screen.getAllByText('configure');
    fireEvent.click(configureButtons[0]);
    expect(onEditPartner).toHaveBeenCalledWith(activePartner);
  });

  it('calls onDeletePartner when delete button is clicked for inactive partner', () => {
    renderComponent();
    fireEvent.click(screen.getByText('delete_permanently'));
    expect(onDeletePartner).toHaveBeenCalledWith(inactivePartner);
  });

  it('shows deactivate confirmation dialog when deactivate is clicked', () => {
    renderComponent();
    fireEvent.click(screen.getByText('deactivate'));
    expect(screen.getByText(/confirm_deactivate_partner/)).toBeInTheDocument();
  });

  it('calls reactivate mutation when reactivate button is clicked', () => {
    renderComponent();
    fireEvent.click(screen.getByText('reactivate'));
    expect(mockReactivate.mutate).toHaveBeenCalledWith({ partnerId: 'p2' });
  });
});

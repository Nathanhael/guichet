import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginView from './LoginView';
import useStore from '../store/useStore';
import { trpc } from '../utils/trpc';

// Mock trpc
vi.mock('../utils/trpc', () => ({
  trpc: {
    user: {
      list: {
        useQuery: vi.fn(),
      },
    },
  },
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock alert
const mockAlert = vi.fn();
global.alert = mockAlert;

describe('LoginView Component', () => {
  const mockUsers = [
    { id: 'u1', name: 'Agent Alice', role: 'agent', dept: 'DSC', lang: 'nl' },
    { id: 'u2', name: 'Expert Bob', role: 'expert', dept: 'FOT', lang: 'fr' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (trpc.user.list.useQuery as any).mockReturnValue({
      data: mockUsers,
      isLoading: false,
    });
  });

  it('renders loading state', () => {
    (trpc.user.list.useQuery as any).mockReturnValue({
      data: undefined,
      isLoading: true,
    });
    render(<LoginView />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('renders list of users', () => {
    render(<LoginView />);
    expect(screen.getByText('Agent Alice')).toBeInTheDocument();
    expect(screen.getByText('Expert Bob')).toBeInTheDocument();
  });

  it('filters users by role', () => {
    render(<LoginView />);
    
    const expertFilter = screen.getByText('Expert', { selector: 'button' });
    fireEvent.click(expertFilter);
    
    expect(screen.queryByText('Agent Alice')).not.toBeInTheDocument();
    expect(screen.getByText('Expert Bob')).toBeInTheDocument();
  });

  it('handles successful login', async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({ token: 't123', user: mockUsers[0] }),
    };
    mockFetch.mockResolvedValue(mockResponse);
    
    render(<LoginView />);
    const aliceBtn = screen.getByText('Agent Alice').closest('button')!;
    fireEvent.click(aliceBtn);
    
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/auth/login', expect.any(Object));
      expect(useStore.getState().token).toBe('t123');
      expect(useStore.getState().user?.id).toBe('u1');
    });
  });

  it('handles login failure', async () => {
    const mockResponse = {
      ok: false,
    };
    mockFetch.mockResolvedValue(mockResponse);
    
    render(<LoginView />);
    const aliceBtn = screen.getByText('Agent Alice').closest('button')!;
    fireEvent.click(aliceBtn);
    
    await waitFor(() => {
      expect(mockAlert).toHaveBeenCalledWith(expect.stringContaining('Login failed'));
    });
  });
});

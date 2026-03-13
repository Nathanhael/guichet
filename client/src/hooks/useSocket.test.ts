import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSocket } from './useSocket';
import useStore from '../store/useStore';

// Mock socket.io-client
const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

// Mock notifications to avoid errors
vi.mock('../utils/notifications', () => ({
  playChime: vi.fn(),
  requestNotificationPermission: vi.fn(),
}));

describe('useSocket hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store
    act(() => {
      useStore.getState().setUser(null);
      useStore.getState().setTickets([]);
    });
  });

  it('initializes socket and attaches listeners only once', () => {
    const { rerender } = renderHook(() => useSocket());
    const initialOnCalls = mockSocket.on.mock.calls.length;
    expect(initialOnCalls).toBeGreaterThan(0);

    rerender();
    expect(mockSocket.on.mock.calls.length).toBe(initialOnCalls);
  });

  it('identifies user when user is set in store', () => {
    const user = { id: 'u1', name: 'User 1', role: 'agent' as const, dept: 'DSC', lang: 'nl' as const };
    
    // Set user first
    act(() => {
      useStore.getState().setUser(user);
    });
    
    renderHook(() => useSocket());
    
    expect(mockSocket.emit).toHaveBeenCalledWith('socket:identify', {
      userId: 'u1',
      role: 'agent',
      name: 'User 1'
    });
  });

  it('handles ticket:created event', () => {
    renderHook(() => useSocket());
    
    const callback = mockSocket.on.mock.calls.find(args => args[0] === 'ticket:created')?.[1];
    expect(callback).toBeDefined();
    
    const ticket = { id: 't1', agentName: 'Agent A', dept: 'DSC', status: 'open', createdAt: new Date().toISOString() };
    act(() => {
      callback({ ticket });
    });
    
    expect(useStore.getState().tickets).toContainEqual(ticket);
  });

  it('handles message:new event', () => {
    renderHook(() => useSocket());
    
    const callback = mockSocket.on.mock.calls.find(args => args[0] === 'message:new')?.[1];
    const message = { 
      id: 'm1', 
      ticketId: 't1', 
      senderId: 'u2', 
      senderName: 'Expert X', 
      text: 'Hello', 
      system: false,
      createdAt: new Date().toISOString() 
    };
    
    act(() => {
      callback(message);
    });
    
    expect(useStore.getState().messages['t1']).toContainEqual(message);
    expect(useStore.getState().unreadTickets.has('t1')).toBe(true);
    expect(mockSocket.emit).toHaveBeenCalledWith('message:delivered', { ticketId: 't1', messageId: 'm1' });
  });

  it('removes listeners on unmount', () => {
    const { unmount } = renderHook(() => useSocket());
    unmount();
    expect(mockSocket.off).toHaveBeenCalled();
  });
});

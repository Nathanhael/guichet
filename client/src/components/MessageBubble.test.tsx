import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MessageBubble from './MessageBubble';
import useStore from '../store/useStore';

// Mock getSocket
const mockEmit = vi.fn();
vi.mock('../hooks/useSocket', () => ({
  getSocket: () => ({
    emit: mockEmit,
  }),
}));

describe('MessageBubble Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.getState().setSelectedLang('en');
  });

  const mockMessage = {
    id: 'm1',
    ticketId: 't1',
    senderId: 'u1',
    senderName: 'Agent A',
    text: 'Hello world',
    createdAt: new Date().toISOString(),
    system: false,
  };

  it('renders message text', () => {
    render(<MessageBubble message={mockMessage} ticketId="t1" />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders system message correctly', () => {
    const systemMsg = { ...mockMessage, system: true, text: 'System alert' };
    render(<MessageBubble message={systemMsg} ticketId="t1" />);
    expect(screen.getByText('System alert')).toBeInTheDocument();
    expect(screen.getByText('System alert')).toHaveClass('text-[10px]');
  });

  it('shows sender name for messages from others', () => {
    useStore.getState().setUser({ id: 'u2', name: 'Expert X', role: 'expert', dept: 'DSC', lang: 'nl' });
    render(<MessageBubble message={mockMessage} ticketId="t1" />);
    expect(screen.getByText('Agent A')).toBeInTheDocument();
  });

  it('hides sender name for own messages', () => {
    useStore.getState().setUser({ id: 'u1', name: 'Agent A', role: 'agent', dept: 'DSC', lang: 'nl' });
    render(<MessageBubble message={mockMessage} ticketId="t1" />);
    expect(screen.queryByText('Agent A')).not.toBeInTheDocument();
  });

  it('renders whisper indicator for whispers', () => {
    const whisperMsg = { ...mockMessage, whisper: true };
    render(<MessageBubble message={whisperMsg} ticketId="t1" />);
    expect(screen.getByText(/Internal Whisper/i)).toBeInTheDocument();
  });

  it('toggles original/translated text', () => {
    const translatedMsg = { 
      ...mockMessage, 
      senderId: 'u1',
      processedText: 'Hallo wereld',
      originalText: 'Hello world',
      improvedText: 'Hello world',
      translationSkipped: false 
    };
    useStore.getState().setUser({ id: 'u2', name: 'Expert X', role: 'expert', dept: 'DSC', lang: 'nl' });
    
    render(<MessageBubble message={translatedMsg} ticketId="t1" />);
    
    // Shows translation by default
    expect(screen.getByText('Hallo wereld')).toBeInTheDocument();
    
    // Find original toggle button
    const toggleBtn = screen.getByRole('button', { name: /Original/i });
    fireEvent.click(toggleBtn);
    
    expect(screen.getByText('Hello world')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Translation/i })).toBeInTheDocument();
  });

  it('shows reaction picker when clicking reaction button', () => {
    render(<MessageBubble message={mockMessage} ticketId="t1" />);
    
    // Find reaction picker button (has title "Add reaction")
    const pickerBtn = screen.getByTitle(/Add reaction/i);
    fireEvent.click(pickerBtn);
    
    // Should show emoji buttons (e.g. heart)
    expect(screen.getByText('❤️')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MessageBubble from './MessageBubble';
import useStore from '../store/useStore';
import { Message } from '../types';

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

  const mockMessage: Message = {
    id: 'm1',
    ticketId: 't1',
    senderId: 'u1',
    senderName: 'Agent A',
    senderRole: 'agent',
    senderLang: 'en',
    originalText: 'Hello world',
    improvedText: 'Hello world',
    processedText: 'Hello world',
    text: 'Hello world',
    timestamp: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    system: 0,
    whisper: 0,
    translationSkipped: 1,
    fallback: 0,
    reactions: {},
  };

  it('renders message text', () => {
    render(<MessageBubble message={mockMessage} ticketId="t1" />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders system message correctly', () => {
    const systemMsg = { ...mockMessage, system: 1, text: 'System alert' };
    render(<MessageBubble message={systemMsg} ticketId="t1" />);
    expect(screen.getByText('System alert')).toBeInTheDocument();
    expect(screen.getByText('System alert')).toHaveClass('text-[10px]');
  });

  it('shows sender name for messages from others', () => {
    useStore.getState().setUser({ id: 'u2', name: 'Support X', role: 'support', dept: 'DSC', lang: 'nl', isPlatformOperator: false });
    render(<MessageBubble message={mockMessage} ticketId="t1" />);
    expect(screen.getByText('Agent A')).toBeInTheDocument();
  });

  it('hides sender name for own messages', () => {
    useStore.getState().setUser({ id: 'u1', name: 'Agent A', role: 'agent', dept: 'DSC', lang: 'nl', isPlatformOperator: false });
    render(<MessageBubble message={mockMessage} ticketId="t1" />);
    expect(screen.queryByText('Agent A')).not.toBeInTheDocument();
  });

  it('renders whisper indicator for whispers', () => {
    const whisperMsg = { ...mockMessage, whisper: 1 };
    render(<MessageBubble message={whisperMsg} ticketId="t1" />);
    expect(screen.getByText(/Internal mode/i)).toBeInTheDocument();
  });

  it('toggles original/translated text', () => {
    const translatedMsg = { 
      ...mockMessage, 
      senderId: 'u1',
      processedText: 'Hallo wereld',
      originalText: 'Hello world',
      improvedText: 'Hello world',
      translationSkipped: 0 
    };
    useStore.getState().setUser({ id: 'u2', name: 'Support X', role: 'support', dept: 'DSC', lang: 'nl', isPlatformOperator: false });
    
    render(<MessageBubble message={translatedMsg} ticketId="t1" />);
    
    // Shows translation by default
    expect(screen.getByText('Hallo wereld')).toBeInTheDocument();
    
    // Find AI toggle button (titles "Original" when showing translation)
    const toggleBtn = screen.getByTitle(/Original/i);
    fireEvent.click(toggleBtn);
    
    expect(screen.getByText('Hello world')).toBeInTheDocument();
    // After click, title changes to "Translation"
    expect(screen.getByTitle(/Translation/i)).toBeInTheDocument();
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

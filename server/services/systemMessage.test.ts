import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the db module before importing the service
vi.mock('../db/postgres.js', () => ({
  db: {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

import { insertSystemMessage } from './systemMessage.js';

describe('insertSystemMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a well-formed system message object', async () => {
    const result = await insertSystemMessage('ticket-1', 'Agent joined the chat');

    expect(result).toMatchObject({
      id: 'test-uuid-1234',
      ticketId: 'ticket-1',
      senderId: '__system__',
      senderName: 'System',
      senderRole: 'admin',
      senderLang: 'en',
      text: 'Agent joined the chat',
      originalText: 'Agent joined the chat',
      whisper: false,
      system: true,
    });
    expect(result.timestamp).toBeDefined();
    expect(result.createdAt).toBeDefined();
    expect(result.reactions).toEqual({});
  });

  it('returns consistent timestamp and createdAt', async () => {
    const result = await insertSystemMessage('ticket-2', 'Ticket transferred');
    expect(result.timestamp).toBe(result.createdAt);
  });
});

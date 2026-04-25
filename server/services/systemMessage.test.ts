import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./messageQueries.js', () => ({
  insertMessage: vi.fn().mockResolvedValue({
    id: 'test-uuid-1234',
    ticketId: 't1',
    senderId: '__system__',
    senderName: 'System',
    senderRole: 'admin',
    senderLang: 'en',
    text: 'Agent joined the chat',
    originalText: 'Agent joined the chat',
    whisper: false,
    system: true,
    timestamp: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    reactions: {},
  }),
}));

import { insertSystemMessage } from './systemMessage.js';
import { insertMessage } from './messageQueries.js';

describe('insertSystemMessage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to insertMessage with system flags', async () => {
    await insertSystemMessage('ticket-1', 'Agent joined the chat');

    expect(insertMessage).toHaveBeenCalledWith({
      ticketId: 'ticket-1',
      senderId: '__system__',
      senderName: 'System',
      senderRole: 'admin',
      senderLang: 'en',
      // System messages are never attributed to a guest.
      senderIsExternal: false,
      text: 'Agent joined the chat',
      system: true,
    });
  });

  it('returns the socket-ready message from insertMessage', async () => {
    const result = await insertSystemMessage('ticket-1', 'Agent joined the chat');

    expect(result).toMatchObject({
      senderId: '__system__',
      senderName: 'System',
      system: true,
      whisper: false,
    });
    expect(result.timestamp).toBeDefined();
    expect(result.createdAt).toBeDefined();
    expect(result.reactions).toEqual({});
  });
});

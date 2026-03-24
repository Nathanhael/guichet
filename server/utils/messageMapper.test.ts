import { describe, expect, it } from 'vitest';
import { mapMessageRow } from './messageMapper.js';

describe('mapMessageRow', () => {
  it('maps snake_case row to Message shape', () => {
    const row = {
      id: 'msg-1',
      ticket_id: 'tk-1',
      sender_id: 'user-1',
      sender_name: 'Alice',
      sender_role: 'agent',
      sender_lang: 'en',
      text: 'Hello world',
      media_url: null,
      whisper: 0,
      system: 0,
      created_at: '2026-03-24T10:00:00Z',
      reactions: '{}',
    };

    const result = mapMessageRow(row);

    expect(result.id).toBe('msg-1');
    expect(result.ticketId).toBe('tk-1');
    expect(result.senderId).toBe('user-1');
    expect(result.senderName).toBe('Alice');
    expect(result.senderRole).toBe('agent');
    expect(result.senderLang).toBe('en');
    expect(result.originalText).toBe('Hello world');
    expect(result.processedText).toBe('Hello world');
    expect(result.improvedText).toBe('Hello world');
    expect(result.text).toBe('Hello world');
    expect(result.mediaUrl).toBeNull();
    expect(result.whisper).toBe(0);
    expect(result.system).toBe(0);
    expect(result.timestamp).toBe('2026-03-24T10:00:00Z');
    expect(result.createdAt).toBe('2026-03-24T10:00:00Z');
    expect(result.translationSkipped).toBe(1);
    expect(result.fallback).toBe(0);
  });

  it('maps camelCase row (Drizzle ORM format)', () => {
    const row = {
      id: 'msg-2',
      ticketId: 'tk-2',
      senderId: 'user-2',
      senderName: 'Bob',
      senderRole: 'support',
      senderLang: 'fr',
      text: 'Bonjour',
      mediaUrl: 'https://cdn.example.com/img.png',
      whisper: 1,
      system: 0,
      createdAt: '2026-03-24T11:00:00Z',
      reactions: '{"thumbsUp":["user-1"]}',
    };

    const result = mapMessageRow(row);

    expect(result.ticketId).toBe('tk-2');
    expect(result.senderId).toBe('user-2');
    expect(result.senderLang).toBe('fr');
    expect(result.mediaUrl).toBe('https://cdn.example.com/img.png');
    expect(result.whisper).toBe(1);
    expect(result.createdAt).toBe('2026-03-24T11:00:00Z');
  });

  it('handles missing optional fields gracefully', () => {
    const row = {
      id: 'msg-3',
      text: '',
    };

    const result = mapMessageRow(row);

    expect(result.id).toBe('msg-3');
    expect(result.senderName).toBe('');
    expect(result.senderRole).toBe('system');
    expect(result.senderLang).toBe('en');
    expect(result.originalText).toBe('');
    expect(result.mediaUrl).toBeNull();
    expect(result.whisper).toBe(0);
    expect(result.system).toBe(0);
  });

  it('handles reactions as object (not string)', () => {
    const row = {
      id: 'msg-4',
      text: 'test',
      reactions: { heart: ['user-1', 'user-2'] },
    };

    const result = mapMessageRow(row);

    // Should serialize the object to string
    expect(JSON.parse(result.reactions as string)).toEqual({ heart: ['user-1', 'user-2'] });
  });

  it('handles malformed reactions JSON', () => {
    const row = {
      id: 'msg-5',
      text: 'test',
      reactions: '{invalid json',
    };

    const result = mapMessageRow(row);

    // Should fall back to empty object
    expect(result.reactions).toBe('{}');
  });

  it('converts truthy whisper/system to 1', () => {
    const row = {
      id: 'msg-6',
      text: 'internal',
      whisper: true,
      system: true,
    };

    const result = mapMessageRow(row);

    expect(result.whisper).toBe(1);
    expect(result.system).toBe(1);
  });

  it('converts falsy whisper/system to 0', () => {
    const row = {
      id: 'msg-7',
      text: 'normal',
      whisper: false,
      system: false,
    };

    const result = mapMessageRow(row);

    expect(result.whisper).toBe(0);
    expect(result.system).toBe(0);
  });

  it('prefers snake_case over camelCase when both present', () => {
    const row = {
      id: 'msg-8',
      ticket_id: 'snake-tk',
      ticketId: 'camel-tk',
      sender_id: 'snake-user',
      senderId: 'camel-user',
      text: 'test',
      created_at: '2026-01-01T00:00:00Z',
      createdAt: '2026-12-31T23:59:59Z',
    };

    const result = mapMessageRow(row);

    // snake_case takes precedence (|| short-circuits)
    expect(result.ticketId).toBe('snake-tk');
    expect(result.senderId).toBe('snake-user');
    expect(result.timestamp).toBe('2026-01-01T00:00:00Z');
  });
});

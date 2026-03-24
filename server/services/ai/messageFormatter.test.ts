import { describe, it, expect } from 'vitest';
import { formatMessagesForAi } from './messageFormatter.js';

const msg = (name: string, role: string, text: string) => ({
  senderName: name,
  senderRole: role,
  text,
});

describe('formatMessagesForAi', () => {
  it('formats empty messages', () => {
    expect(formatMessagesForAi([])).toBe('(no messages)');
  });

  it('formats a single message', () => {
    const result = formatMessagesForAi([msg('Alice', 'agent', 'Help me')]);
    expect(result).toBe('[Alice (agent)]: Help me');
  });

  it('formats multiple messages with names and roles', () => {
    const result = formatMessagesForAi([
      msg('Alice', 'agent', 'I have a problem'),
      msg('Bob', 'support', 'How can I help?'),
    ]);
    expect(result).toContain('[Alice (agent)]: I have a problem');
    expect(result).toContain('[Bob (support)]: How can I help?');
  });

  it('does not truncate when under the limit', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => msg(`User${i}`, 'agent', `Message ${i}`));
    const result = formatMessagesForAi(msgs, 50);
    expect(result.split('\n')).toHaveLength(10);
    expect(result).not.toContain('omitted');
  });

  it('truncates when over the limit, keeping first 5 and last N', () => {
    const msgs = Array.from({ length: 60 }, (_, i) => msg(`User${i}`, 'agent', `Message ${i}`));
    const result = formatMessagesForAi(msgs, 50);
    const lines = result.split('\n');
    // 5 head + 1 omission marker + 45 tail = 51 lines
    expect(lines).toHaveLength(51);
    expect(lines[0]).toContain('User0');
    expect(lines[4]).toContain('User4');
    expect(lines[5]).toContain('10 messages omitted for brevity');
    expect(lines[6]).toContain('User15');
    expect(lines[50]).toContain('User59');
  });

  it('truncates individual long messages', () => {
    const longText = 'x'.repeat(1000);
    const result = formatMessagesForAi([msg('Alice', 'agent', longText)]);
    expect(result.length).toBeLessThan(600); // 500 chars + name/role prefix + ...
    expect(result).toContain('...');
  });

  it('handles null sender name and role', () => {
    const result = formatMessagesForAi([{ senderName: null, senderRole: null, text: 'Hi' }]);
    expect(result).toBe('[Unknown (user)]: Hi');
  });

  it('handles null text', () => {
    const result = formatMessagesForAi([{ senderName: 'Alice', senderRole: 'agent', text: null }]);
    expect(result).toBe('[Alice (agent)]: ');
  });

  it('respects custom maxMessages parameter', () => {
    const msgs = Array.from({ length: 20 }, (_, i) => msg(`U${i}`, 'agent', `M${i}`));
    const result = formatMessagesForAi(msgs, 10);
    const lines = result.split('\n');
    // 5 head + 1 marker + 5 tail = 11
    expect(lines).toHaveLength(11);
    expect(lines[5]).toContain('10 messages omitted for brevity');
  });
});

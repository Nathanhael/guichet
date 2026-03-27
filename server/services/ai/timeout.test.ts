import { describe, it, expect } from 'vitest';

describe('AI timeout config', () => {
  it('AI_TIMEOUT_MS defaults to 60000', async () => {
    // Dynamic import so env is read fresh
    const { default: config } = await import('../../config.js');
    expect(config.AI_TIMEOUT_MS).toBe(60000);
  });

  it('OLLAMA_KEEPALIVE defaults to "30m"', async () => {
    const { default: config } = await import('../../config.js');
    expect(config.OLLAMA_KEEPALIVE).toBe('30m');
  });
});

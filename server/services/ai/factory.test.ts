import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config before importing factory
vi.mock('../../config.js', () => ({
  default: {
    AI_ENABLED: true,
    AI_PROVIDER: 'ollama',
    OLLAMA_HOST: 'http://localhost:11434',
    OLLAMA_MODEL: 'llama3',
    AI_BASE_URL: undefined,
    AI_API_KEY: undefined,
    AZURE_OPENAI_DEPLOYMENT: undefined,
    REDIS_URL: 'redis://localhost:6379',
  },
}));

// Mock the database
vi.mock('../../db/postgres.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
}));

import { clearProviderCache } from './factory.js';

describe('AI Factory', () => {
  beforeEach(() => {
    clearProviderCache();
  });

  it('clearProviderCache does not throw', () => {
    expect(() => clearProviderCache()).not.toThrow();
  });

  it('can be imported without errors', async () => {
    const mod = await import('./factory.js');
    expect(mod.getProvider).toBeDefined();
    expect(mod.isAiEnabled).toBeDefined();
    expect(mod.clearProviderCache).toBeDefined();
  });
});

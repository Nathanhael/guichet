import { describe, it, expect } from 'vitest';
import { z } from 'zod/v4';

// Replicate the relevant schema subset for isolated testing
const timeoutSchema = z.object({
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
});

describe('AI timeout config', () => {
  it('AI_TIMEOUT_MS defaults to 60000', () => {
    const result = timeoutSchema.parse({});
    expect(result.AI_TIMEOUT_MS).toBe(60000);
  });

  it('AI_TIMEOUT_MS accepts custom values', () => {
    const result = timeoutSchema.parse({ AI_TIMEOUT_MS: '30000' });
    expect(result.AI_TIMEOUT_MS).toBe(30000);
  });

  it('AI_TIMEOUT_MS rejects negative values', () => {
    expect(() => timeoutSchema.parse({ AI_TIMEOUT_MS: '-1' })).toThrow();
  });

  it('AI_TIMEOUT_MS rejects zero', () => {
    expect(() => timeoutSchema.parse({ AI_TIMEOUT_MS: '0' })).toThrow();
  });

  it('AI_TIMEOUT_MS rejects non-numeric strings', () => {
    expect(() => timeoutSchema.parse({ AI_TIMEOUT_MS: 'abc' })).toThrow();
  });
});

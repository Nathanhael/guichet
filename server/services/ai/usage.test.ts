import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockValues = vi.fn().mockResolvedValue(undefined);
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

vi.mock('./context.js', () => ({
  getAiContext: () => ({
    db: { insert: mockInsert },
    schema: { aiUsageLog: 'aiUsageLog' },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    config: {} as never,
    decrypt: (s: string) => s,
  }),
}));

import { logUsage } from './usage';
import type { AiUsageEntry } from './types';

const baseEntry: AiUsageEntry = {
  partnerId: 'p-1',
  userId: 'u-1',
  action: 'improve',
  provider: 'azure-openai',
  model: 'gpt-5-mini',
  inputTokens: 12,
  outputTokens: 8,
  latencyMs: 230,
  success: true,
};

function lastInsertedRow() {
  return mockValues.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
}

describe('logUsage — metadata storage gating (slice 0008 / 2.5 storage)', () => {
  beforeEach(() => {
    mockValues.mockReset().mockResolvedValue(undefined);
    mockInsert.mockClear();
  });

  it('writes metadata=null when neither prompt nor response is set', async () => {
    await logUsage({ ...baseEntry });
    expect(lastInsertedRow()?.metadata).toBeNull();
  });

  it('stores prompt + response in metadata when both provided', async () => {
    await logUsage({ ...baseEntry, prompt: 'translate this', response: 'vertaal dit' });
    expect(lastInsertedRow()?.metadata).toEqual({
      prompt: 'translate this',
      response: 'vertaal dit',
    });
  });

  it('stores only prompt when response is undefined (failure-path full-mode)', async () => {
    await logUsage({ ...baseEntry, success: false, prompt: 'translate this' });
    expect(lastInsertedRow()?.metadata).toEqual({ prompt: 'translate this' });
  });

  it('stores only response when prompt is undefined (defensive — should not normally happen)', async () => {
    await logUsage({ ...baseEntry, response: 'output' });
    expect(lastInsertedRow()?.metadata).toEqual({ response: 'output' });
  });

  it('returns the generated row id on success', async () => {
    const id = await logUsage({ ...baseEntry });
    expect(typeof id).toBe('string');
    expect(id?.length).toBeGreaterThan(0);
    expect(lastInsertedRow()?.id).toBe(id);
  });

  it('returns null and does not throw when the DB write rejects', async () => {
    mockValues.mockReset().mockRejectedValue(new Error('DB down'));
    const id = await logUsage({ ...baseEntry, prompt: 'p', response: 'r' });
    expect(id).toBeNull();
  });

  it('round-trips standard metadata fields untouched (id, partnerId, success, latency, etc.)', async () => {
    await logUsage({ ...baseEntry, prompt: 'p', response: 'r' });
    const row = lastInsertedRow();
    expect(row?.partnerId).toBe('p-1');
    expect(row?.userId).toBe('u-1');
    expect(row?.action).toBe('improve');
    expect(row?.provider).toBe('azure-openai');
    expect(row?.model).toBe('gpt-5-mini');
    expect(row?.inputTokens).toBe(12);
    expect(row?.outputTokens).toBe(8);
    expect(row?.latencyMs).toBe(230);
    expect(row?.success).toBe(true);
    expect(row?.errorMessage).toBeNull();
  });
});

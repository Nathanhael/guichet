import { describe, it, expect } from 'vitest';

describe('validateAiBaseUrl', () => {
  it('rejects http:// in production', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('http://example.com', false)).toThrow('HTTPS required');
  });

  it('allows http:// in development', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('http://example.com', true)).not.toThrow();
  });

  it('rejects localhost', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('https://localhost/api', false)).toThrow('private');
  });

  it('rejects 127.0.0.1', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('https://127.0.0.1/api', false)).toThrow('private');
  });

  it('rejects 10.x.x.x', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('https://10.0.0.5:8080/v1', false)).toThrow('private');
  });

  it('rejects 172.16.x.x', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('https://172.16.0.1/v1', false)).toThrow('private');
  });

  it('rejects 192.168.x.x', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('https://192.168.1.1/v1', false)).toThrow('private');
  });

  it('rejects 169.254.x.x (AWS metadata)', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('https://169.254.169.254/latest', false)).toThrow('private');
  });

  it('rejects 0.0.0.0', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('https://0.0.0.0/api', false)).toThrow('private');
  });

  it('allows valid public HTTPS URL', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('https://api.openai.com/v1', false)).not.toThrow();
  });

  it('allows undefined (uses default)', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl(undefined, false)).not.toThrow();
  });

  it('rejects invalid URLs', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('not-a-url', false)).toThrow();
  });
});

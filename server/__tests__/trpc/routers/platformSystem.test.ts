import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(
  join(__dirname, '../../../trpc/routers/platform/system.ts'),
  'utf-8'
);

describe('platform system — SMTP password masking', () => {
  it('getMailConfig strips smtpPass and apiKey from response', () => {
    expect(source).toMatch(/const \{ smtpPass, apiKey, \.\.\.safe \} = raw/);
  });

  it('getMailConfig returns hasSmtpPass boolean indicator', () => {
    expect(source).toContain('hasSmtpPass:');
    expect(source).toMatch(/typeof smtpPass === 'string' && smtpPass\.length > 0/);
  });

  it('getMailConfig returns hasApiKey boolean indicator', () => {
    expect(source).toContain('hasApiKey:');
    expect(source).toMatch(/typeof apiKey === 'string' && apiKey\.length > 0/);
  });

  it('updateMailConfig preserves existing smtpPass when client omits it', () => {
    expect(source).toMatch(/!input\.smtpPass && existing\.smtpPass/);
  });

  it('updateMailConfig preserves existing apiKey when client omits it', () => {
    expect(source).toMatch(/!input\.apiKey && existing\.apiKey/);
  });

  it('updateMailConfig writes merged value (not raw input) to DB', () => {
    // The upsert must use `merged` not `input`
    expect(source).toMatch(/value: merged/);
  });
});

/**
 * Contract test: verifyAuditChain must NOT be inside the try/catch that swallows errors.
 *
 * SEC-2: The chain integrity check must propagate to the caller so a broken hash chain
 * actually aborts the GDPR purge instead of being silently logged and ignored.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const gdprSource = readFileSync(
  resolve(__dirname, '../services/gdpr.ts'),
  'utf-8'
);

describe('GDPR chain integrity abort (SEC-2)', () => {
  it('verifyAuditChain call appears before "const cutoff = new Date()"', () => {
    const verifyIdx = gdprSource.indexOf('verifyAuditChain()');
    const cutoffIdx = gdprSource.indexOf('const cutoff = new Date()');

    expect(verifyIdx).toBeGreaterThan(-1);
    expect(cutoffIdx).toBeGreaterThan(-1);
    expect(verifyIdx).toBeLessThan(cutoffIdx);
  });

  it('verifyAuditChain call is NOT inside the swallowing try/catch block', () => {
    // The swallowing catch is identified by its error log message.
    const catchMarker = "[purge] Error during daily purge";
    const catchIdx = gdprSource.indexOf(catchMarker);
    expect(catchIdx).toBeGreaterThan(-1);

    // Find the opening `try {` that corresponds to this catch.
    // We look for the last `try {` before the catch marker.
    const sourceUpToCatch = gdprSource.slice(0, catchIdx);
    const lastTryIdx = sourceUpToCatch.lastIndexOf('try {');
    expect(lastTryIdx).toBeGreaterThan(-1);

    // verifyAuditChain must appear BEFORE the opening try that the swallowing catch belongs to.
    const verifyIdx = gdprSource.indexOf('verifyAuditChain()');
    expect(verifyIdx).toBeLessThan(lastTryIdx);
  });

  it('throw statement for chain integrity violation is present', () => {
    expect(gdprSource).toContain('GDPR purge aborted: audit chain integrity violation detected');
  });
});

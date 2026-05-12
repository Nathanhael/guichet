/**
 * Contract test: verifyAuditChain must NOT be inside the try/catch that swallows errors.
 *
 * SEC-2: The chain integrity check must propagate to the caller so a broken hash chain
 * actually aborts the GDPR purge instead of being silently logged and ignored.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PurgeAbortedError } from '../services/gdpr.js';

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

  it('chain-broken throw uses structured PurgeAbortedError', () => {
    // The throw must use the typed error so callers can branch on
    // `reason.kind` instead of grepping log message strings. The throw
    // also has to live BEFORE the swallowing try/catch — same invariant
    // as the previous string-throw, just with a richer signal.
    const throwIdx = gdprSource.indexOf('throw new PurgeAbortedError(');
    expect(throwIdx).toBeGreaterThan(-1);

    const catchMarker = "[purge] Error during daily purge";
    const sourceUpToCatch = gdprSource.slice(0, gdprSource.indexOf(catchMarker));
    const lastTryIdx = sourceUpToCatch.lastIndexOf('try {');
    expect(throwIdx).toBeLessThan(lastTryIdx);
  });

  it('PurgeAbortedError carries a discriminated reason.kind', () => {
    // Compile-time + runtime sanity: instantiating the error keeps the
    // reason payload available to callers (the bug we want to make
    // impossible: re-introducing a string-message-only abort).
    const broken = new PurgeAbortedError({ kind: 'chain_broken', brokenAt: 'row-1', checked: 5 });
    expect(broken).toBeInstanceOf(Error);
    expect(broken.name).toBe('PurgeAbortedError');
    expect(broken.reason.kind).toBe('chain_broken');

    const infra = new PurgeAbortedError({ kind: 'chain_infra_error', error: 'verification_failed' });
    expect(infra.reason.kind).toBe('chain_infra_error');
  });
});

/**
 * Contract test: the chain-verify gate must NOT be inside the try/catch
 * that swallows errors in runDailyPurge.
 *
 * SEC-2: A broken hash chain must propagate to the caller so the purge
 * actually aborts instead of being silently logged and ignored.
 *
 * Structure post-split: runDailyPurge (in services/gdpr.ts) calls
 * `archiveAndVerify()` from services/gdpr/archiveStep.ts BEFORE its
 * swallowing try block; archiveAndVerify is where the chain check + throw
 * live. The two source files are grep'd together to keep the invariant
 * tested at the structural level instead of the runtime level (which would
 * require a full DB fixture).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PurgeAbortedError } from '../services/gdpr.js';

const orchestratorSource = readFileSync(
  resolve(__dirname, '../services/gdpr.ts'),
  'utf-8',
);
const archiveStepSource = readFileSync(
  resolve(__dirname, '../services/gdpr/archiveStep.ts'),
  'utf-8',
);

describe('GDPR chain integrity abort (SEC-2)', () => {
  it('archiveAndVerify call appears before "const cutoff = new Date()"', () => {
    const verifyIdx = orchestratorSource.indexOf('archiveAndVerify()');
    const cutoffIdx = orchestratorSource.indexOf('const cutoff = new Date()');

    expect(verifyIdx).toBeGreaterThan(-1);
    expect(cutoffIdx).toBeGreaterThan(-1);
    expect(verifyIdx).toBeLessThan(cutoffIdx);
  });

  it('archiveAndVerify call is NOT inside the swallowing try/catch block', () => {
    const catchMarker = "[purge] Error during daily purge";
    const catchIdx = orchestratorSource.indexOf(catchMarker);
    expect(catchIdx).toBeGreaterThan(-1);

    const sourceUpToCatch = orchestratorSource.slice(0, catchIdx);
    const lastTryIdx = sourceUpToCatch.lastIndexOf('try {');
    expect(lastTryIdx).toBeGreaterThan(-1);

    const verifyIdx = orchestratorSource.indexOf('archiveAndVerify()');
    expect(verifyIdx).toBeLessThan(lastTryIdx);
  });

  it('archiveStep performs the chain check and throws PurgeAbortedError on failure', () => {
    // The leaf module is where the actual verifyAuditChain call + structured
    // throw live. Grep both so a future refactor that drops the chain check
    // or swaps the structured throw back to a bare Error fails this test.
    expect(archiveStepSource).toContain('verifyAuditChain()');
    expect(archiveStepSource).toContain('throw new PurgeAbortedError(');
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

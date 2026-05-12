/**
 * Archive-before-purge step.
 *
 * Three operations that MUST run before the purge body, OUTSIDE its
 * swallowing try/catch:
 *   1. archiveAuditLog() — copy expired audit rows into the WORM archive
 *   2. archiveTickets()  — copy expired closed tickets into archived_tickets
 *   3. verifyAuditChain() — recompute the chain hash; abort if broken
 *
 * Abort behavior — throws `PurgeAbortedError` with reason:
 *   - kind: 'chain_broken'       genuine hash mismatch / tamper
 *   - kind: 'chain_infra_error'  verify itself failed (db timeout, etc.)
 *
 * Returns the archive counters on success so the orchestrator can log them.
 * The chain-broken path is the only invariant that callers (metrics,
 * compliance tooling) need to branch on — the counters are observability
 * sugar.
 */

import logger from '../../utils/logger.js';
import { archiveAuditLog, archiveTickets, verifyAuditChain } from '../archive.js';
import { PurgeAbortedError } from './errors.js';

export interface ArchiveStepResult {
  auditArchived: number;
  ticketsArchived: number;
  chainChecked: number;
}

export async function archiveAndVerify(): Promise<ArchiveStepResult> {
  const auditArchived = await archiveAuditLog();
  const ticketsArchived = await archiveTickets();
  if (auditArchived > 0 || ticketsArchived > 0) {
    logger.info({ auditArchived, ticketsArchived }, '[purge] Pre-purge archival complete');
  }

  const chainResult = await verifyAuditChain() as {
    valid: boolean;
    checked: number;
    brokenAt?: string;
    error?: string;
  };

  if (!chainResult.valid) {
    const isInfraError = chainResult.checked === 0 && chainResult.error === 'verification_failed';
    const message = isInfraError
      ? '[purge] Audit chain verification failed due to infrastructure error — aborting purge as precaution'
      : '[purge] AUDIT CHAIN INTEGRITY VIOLATION — hash chain is broken';
    logger.error(
      { brokenAt: chainResult.brokenAt, checked: chainResult.checked, isInfraError },
      message,
    );
    throw new PurgeAbortedError(
      isInfraError
        ? { kind: 'chain_infra_error', error: chainResult.error }
        : { kind: 'chain_broken', brokenAt: chainResult.brokenAt, checked: chainResult.checked },
    );
  }

  if (chainResult.checked > 0) {
    logger.info({ checked: chainResult.checked }, '[purge] Audit chain integrity verified');
  }

  return {
    auditArchived,
    ticketsArchived,
    chainChecked: chainResult.checked,
  };
}

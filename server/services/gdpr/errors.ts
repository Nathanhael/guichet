/**
 * Structured errors thrown by the GDPR purge.
 *
 * Replaces the previous `throw new Error('audit chain verification failed')`
 * string-comparison pattern. Callers can now `instanceof PurgeAbortedError`
 * + switch on `reason.kind` instead of grepping log lines.
 *
 * Only thrown for genuine aborts (chain integrity, infra error). Satellite
 * cleanup failures (storage delete, orphan reaper, rating comments) are
 * swallowed and logged — they never escape `runDailyPurge`.
 */

export type PurgeAbortReason =
  | { kind: 'chain_broken'; brokenAt: string | undefined; checked: number }
  | { kind: 'chain_infra_error'; error: string | undefined };

export class PurgeAbortedError extends Error {
  readonly reason: PurgeAbortReason;

  constructor(reason: PurgeAbortReason) {
    super(`GDPR purge aborted: ${reason.kind}`);
    this.name = 'PurgeAbortedError';
    this.reason = reason;
  }
}

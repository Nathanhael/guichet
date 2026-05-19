import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Source-level assertions for the SWEEP orchestrator only. After PR 1 of
 * the ticket-lifecycle refactor, the mutation + audit + system-message +
 * staff-room broadcast all run inside `services/ticketLifecycle/reclaim.ts`
 * (verified end-to-end by `services/ticketLifecycle/reclaim.test.ts` against
 * a real PGLite). The sweep service that this test guards now only owns:
 *   - short-circuiting when reclaim is disabled
 *   - the candidate DB pre-filter (assigned + stale + not closed)
 *   - the per-row presence/offline-at decision
 *   - delegating each row to `lifecycle.reclaim()`
 *   - per-ticket try/catch so one bad row can't starve the rest
 *
 * Pattern matches drizzleJournal.
 */
const source = readFileSync(
  join(__dirname, '../../services/ticketReclaim.ts'),
  'utf-8',
);

describe('reclaimAbandonedTickets — sweep orchestrator wiring', () => {
  it('short-circuits when RECLAIM_TIMEOUT_MINS is non-positive (disabled)', () => {
    expect(source).toMatch(/if\s*\(\s*timeoutMins\s*<=\s*0\s*\)\s*return/);
  });

  it('filters candidates to assigned-and-stale-and-not-closed rows', () => {
    expect(source).toMatch(/isNotNull\(\s*tickets\.supportId\s*\)/);
    expect(source).toMatch(/lt\(\s*tickets\.supportJoinedAt\s*,\s*cutoff\s*\)/);
    expect(source).toMatch(/ne\(\s*tickets\.status\s*,\s*['"]closed['"]\s*\)/);
  });

  it('derives the offline cutoff timestamp from timeoutMins (minutes → ms)', () => {
    expect(source).toMatch(/offlineThresholdMs\s*=\s*timeoutMins\s*\*\s*60\s*\*\s*1000/);
    expect(source).toMatch(/new\s+Date\(\s*now\s*-\s*offlineThresholdMs\s*\)/);
  });

  it('skips reclaim when the agent has any active presence', () => {
    // Only reclaim when availability.advanced.getStatus returns null (fully offline).
    expect(source).toMatch(/advanced\.getStatus\(\s*ticket\.supportId\s*,\s*ticket\.partnerId\s*\)/);
    expect(source).toMatch(/if\s*\(\s*status\s*!==\s*null\s*\)\s*continue/);
  });

  it('measures abandonment from advanced.offlineSince, not from supportJoinedAt', () => {
    // The whole point of this iteration: a long-held ticket that briefly
    // disconnects must NOT be reclaimed. Source must consult the offline
    // marker before deciding.
    expect(source).toMatch(/advanced\.offlineSince\(\s*ticket\.supportId\s*,\s*ticket\.partnerId\s*\)/);
    expect(source).toMatch(/offlineForMs\s*<\s*offlineThresholdMs[\s\S]*?continue/);
  });

  it('falls back to a wider supportJoinedAt window when the offline marker is absent', () => {
    // Restart fallback: if Redis lost the marker, we still eventually clean
    // up genuinely stale tickets — but only after a much wider window so we
    // do not aggressively reclaim every assigned ticket on each server boot.
    expect(source).toMatch(/RESTART_FALLBACK_MULTIPLIER/);
    expect(source).toMatch(/offlineThresholdMs\s*\*\s*RESTART_FALLBACK_MULTIPLIER/);
  });

  it('delegates the per-ticket work to lifecycle.reclaim with previousSupportId as the race guard', () => {
    // Race-guard lives in `lifecycle.reclaim` (atomic UPDATE … WHERE
    // support_id = previousSupportId). Passing ticket.supportId as
    // previousSupportId is what opts each candidate into the guarded path
    // and produces TICKET_ALREADY_REASSIGNED on a lost race.
    expect(source).toMatch(/lifecycle\.reclaim\(\s*\{[\s\S]*?previousSupportId:\s*ticket\.supportId/);
  });

  it('skips silently when lifecycle.reclaim reports the race was lost', () => {
    // result.ok === false → another agent picked the ticket up between
    // the candidate scan and the atomic write. No log spam, no counter bump.
    expect(source).toMatch(/if\s*\(\s*!\s*result\.ok\s*\)/);
  });

  it('dispatches the lifecycle effect array via applyEffects rather than reaching for io directly', () => {
    // Hand-rolling `io.to(...).emit('ticket:reclaimed', ...)` here would
    // bypass the effect DSL and re-introduce the kind of duplicated
    // orchestration the deepening was meant to remove.
    expect(source).toMatch(/applyEffects\(\s*io\s*,\s*result\.effects\s*\)/);
    expect(source).not.toMatch(/io\.to\([^)]*\)\.emit\(\s*['"]ticket:reclaimed['"]/);
  });

  it('does not hand-roll system messages or audit writes — those live inside the lifecycle module', () => {
    // The sweep file must not import the deprecated shallow helpers; if it
    // does, the lifecycle's transactional guarantee evaporates.
    expect(source).not.toMatch(/insertSystemMessage\b/);
    expect(source).not.toMatch(/auditTicket(?:Reclaimed|ReturnedToQueue|Assigned)/);
    expect(source).not.toMatch(/\.update\(\s*tickets\s*\)[\s\S]*?\.set\(\s*\{\s*supportId:\s*null/);
  });

  it('wraps per-ticket work in try/catch so one failure does not starve the rest', () => {
    // for (...) { try { ... } catch (err) { logger.error(...) } }
    expect(source).toMatch(/for\s*\(\s*const\s+ticket\s+of\s+candidates\s*\)[\s\S]*?try\s*\{[\s\S]*?\}\s*catch\s*\(\s*err[\s\S]*?logger\.error/);
  });

  it('logs a cycle summary only when at least one ticket was reclaimed', () => {
    expect(source).toMatch(/if\s*\(\s*reclaimed\s*>\s*0\s*\)[\s\S]*?logger\.info/);
  });
});

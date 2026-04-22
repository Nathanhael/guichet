import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Source-level assertions for `reclaimAbandonedTickets`. The service is a
 * crash-recovery path — the wiring it MUST NOT regress is what this guards:
 * disabled when cutoff is non-positive, only touches open/pending tickets
 * with an assigned-but-offline agent, atomic update race-guard, per-ticket
 * try/catch so one bad row can't starve the rest, and broadcast/push after
 * a successful reclaim.
 *
 * Pattern matches drizzleJournal / ssoGuestB2b / mailConfigEncryption.
 */
const source = readFileSync(
  join(__dirname, '../../services/ticketReclaim.ts'),
  'utf-8',
);

describe('reclaimAbandonedTickets — crash-recovery wiring', () => {
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
    // Only reclaim when getUserStatus returns null (fully offline).
    expect(source).toMatch(/getUserStatus\(\s*ticket\.supportId\s*,\s*ticket\.partnerId\s*\)/);
    expect(source).toMatch(/if\s*\(\s*status\s*!==\s*null\s*\)\s*continue/);
  });

  it('measures abandonment from getOfflineAt, not from supportJoinedAt', () => {
    // The whole point of this iteration: a long-held ticket that briefly
    // disconnects must NOT be reclaimed. Source must consult the offline
    // marker before deciding.
    expect(source).toMatch(/getOfflineAt\(\s*ticket\.supportId\s*,\s*ticket\.partnerId\s*\)/);
    expect(source).toMatch(/offlineForMs\s*<\s*offlineThresholdMs[\s\S]*?continue/);
  });

  it('falls back to a wider supportJoinedAt window when the offline marker is absent', () => {
    // Restart fallback: if Redis lost the marker, we still eventually clean
    // up genuinely stale tickets — but only after a much wider window so we
    // do not aggressively reclaim every assigned ticket on each server boot.
    expect(source).toMatch(/RESTART_FALLBACK_MULTIPLIER/);
    expect(source).toMatch(/offlineThresholdMs\s*\*\s*RESTART_FALLBACK_MULTIPLIER/);
  });

  it('delegates to returnTicketToQueue with the race-guard supportId so a just-reassigned ticket is not clobbered', () => {
    // Race-guard lives in returnTicketToQueue's supportId branch (atomic SQL
    // UPDATE ... WHERE id = ? AND support_id = ?). Passing ticket.supportId
    // as the second arg is what opts this caller into the guarded path.
    expect(source).toMatch(/returnTicketToQueue\(\s*ticket\.id\s*,\s*ticket\.supportId\s*\)/);
  });

  it('abandons the ticket silently when returnTicketToQueue reports zero rows updated', () => {
    // returnTicketToQueue returns false when the atomic update found no row
    // (another agent grabbed it first). The reclaim loop must skip — no
    // system message, no broadcast, no reclaim counter bump.
    expect(source).toMatch(/if\s*\(\s*!\s*reclaimedOk\s*\)\s*continue/);
  });

  it('resets the ticket via returnTicketToQueue (nulls support_* + status=open live in that helper)', () => {
    // The nulling of support_id/name/joined_at and status→open is the
    // contract of returnTicketToQueue — asserted in ticketQueries.test.ts.
    // Here we just verify the reclaim path goes through that helper and
    // does NOT hand-roll its own db.update(tickets).set({ supportId: null }).
    expect(source).toMatch(/import\s*\{[^}]*\breturnTicketToQueue\b[^}]*\}\s*from\s*['"]\.\/ticketQueries\.js['"]/);
    expect(source).not.toMatch(/\.update\(\s*tickets\s*\)[\s\S]*?\.set\(\s*\{\s*supportId:\s*null/);
  });

  it('writes a system message for audit trail on successful reclaim', () => {
    expect(source).toMatch(/insertSystemMessage\(\s*ticket\.id/);
  });

  it('broadcasts ticket:reclaimed to the partner staff room so queue UIs refresh', () => {
    expect(source).toMatch(/io\.to\(\s*Rooms\.staff\(\s*ticket\.partnerId\s*\)\s*\)\s*\.emit\(\s*['"]ticket:reclaimed['"]/);
  });

  it('wraps per-ticket work in try/catch so one failure does not starve the rest', () => {
    // for (...) { try { ... } catch (err) { logger.error(...) } }
    expect(source).toMatch(/for\s*\(\s*const\s+ticket\s+of\s+candidates\s*\)[\s\S]*?try\s*\{[\s\S]*?\}\s*catch\s*\(\s*err[\s\S]*?logger\.error/);
  });

  it('logs a cycle summary only when at least one ticket was reclaimed', () => {
    expect(source).toMatch(/if\s*\(\s*reclaimed\s*>\s*0\s*\)[\s\S]*?logger\.info/);
  });
});

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

  it('derives the cutoff timestamp from timeoutMins (minutes → ms)', () => {
    expect(source).toMatch(/new\s+Date\(\s*Date\.now\(\)\s*-\s*timeoutMins\s*\*\s*60\s*\*\s*1000\s*\)/);
  });

  it('skips reclaim when the agent has any active presence', () => {
    // Only reclaim when getUserStatus returns null (fully offline).
    expect(source).toMatch(/getUserStatus\(\s*ticket\.supportId\s*,\s*ticket\.partnerId\s*\)/);
    expect(source).toMatch(/if\s*\(\s*status\s*!==\s*null\s*\)\s*continue/);
  });

  it('uses an atomic update race-guarded on supportId to avoid clobbering a just-reassigned ticket', () => {
    // WHERE id = ? AND supportId = <original>
    expect(source).toMatch(
      /\.update\(\s*tickets\s*\)[\s\S]*?\.where\(\s*and\([\s\S]*?eq\(\s*tickets\.id[\s\S]*?eq\(\s*tickets\.supportId\s*,\s*ticket\.supportId/,
    );
  });

  it('abandons the ticket silently when the race-guarded update updated zero rows', () => {
    expect(source).toMatch(/result\.rowCount\s*===\s*0[\s\S]*?continue/);
  });

  it('nulls support_id, support_name, support_joined_at AND resets status to open', () => {
    expect(source).toMatch(/supportId:\s*null/);
    expect(source).toMatch(/supportName:\s*null/);
    expect(source).toMatch(/supportJoinedAt:\s*null/);
    expect(source).toMatch(/status:\s*['"]open['"]/);
  });

  it('writes a system message for audit trail on successful reclaim', () => {
    expect(source).toMatch(/insertSystemMessage\(\s*ticket\.id/);
  });

  it('broadcasts ticket:reclaimed to the partner staff room so queue UIs refresh', () => {
    expect(source).toMatch(/io\.to\(\s*Rooms\.staff\(\s*ticket\.partnerId\s*\)\s*\)\s*\.emit\(\s*['"]ticket:reclaimed['"]/);
  });

  it('pushes a notification only to online support/admin users for that partner', () => {
    expect(source).toMatch(/getOnlineUsersForPartner\(\s*ticket\.partnerId\s*\)/);
    expect(source).toMatch(/u\.role\s*===\s*['"]support['"]\s*\|\|\s*u\.role\s*===\s*['"]admin['"]/);
    expect(source).toMatch(/sendPush\(\s*user\.userId/);
  });

  it('wraps per-ticket work in try/catch so one failure does not starve the rest', () => {
    // for (...) { try { ... } catch (err) { logger.error(...) } }
    expect(source).toMatch(/for\s*\(\s*const\s+ticket\s+of\s+candidates\s*\)[\s\S]*?try\s*\{[\s\S]*?\}\s*catch\s*\(\s*err[\s\S]*?logger\.error/);
  });

  it('logs a cycle summary only when at least one ticket was reclaimed', () => {
    expect(source).toMatch(/if\s*\(\s*reclaimed\s*>\s*0\s*\)[\s\S]*?logger\.info/);
  });
});

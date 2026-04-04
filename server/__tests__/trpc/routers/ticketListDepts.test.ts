import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Source-level regression tests ensuring ticket.list uses JWT context
 * for department isolation — not a redundant DB query.
 */
describe('ticket.list department isolation', () => {
  const source = readFileSync(
    join(__dirname, '../../../trpc/routers/ticket.ts'),
    'utf-8',
  );

  it('does not query the memberships table', () => {
    // The memberships import was removed; ensure it stays removed.
    expect(source).not.toMatch(/from\s*\(\s*memberships\s*\)/);
  });

  it('uses ctx.user.departments for department filtering', () => {
    expect(source).toContain('ctx.user.departments');
  });

  it('does not reference membershipId in the department isolation block', () => {
    // The old pattern checked ctx.user.membershipId to decide whether to query.
    // Department filtering should use ctx.user.departments directly.
    // Anchors: comment "H-6: Department isolation" → next comment "Normalize status filter"
    const startAnchor = 'H-6: Department isolation';
    const endAnchor = '// Normalize status filter';
    const start = source.indexOf(startAnchor);
    const end = source.indexOf(endAnchor);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const deptBlock = source.slice(start, end);
    expect(deptBlock).not.toContain('membershipId');
  });
});

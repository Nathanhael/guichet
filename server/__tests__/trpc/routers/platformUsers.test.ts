import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(
  join(__dirname, '../../../trpc/routers/platform/users.ts'),
  'utf-8'
);

describe('platform users — operator demotion guards', () => {
  it('updateMembership throws NOT_FOUND when membership is missing', () => {
    expect(source).toContain("throw new TRPCError({ code: 'NOT_FOUND', message: 'Membership not found' })");
  });

  it('updateMembership detects operator demotion (wasPlatformOperator && !willBePlatformOperator)', () => {
    expect(source).toMatch(/const isDemotion = wasPlatformOperator && !willBePlatformOperator/);
  });

  it('updateMembership prevents self-demotion', () => {
    expect(source).toContain('memBefore[0].userId === ctx.user.id');
    expect(source).toContain('Cannot demote your own platform operator role');
  });

  it('updateMembership prevents last-operator lockout', () => {
    expect(source).toMatch(/operatorCount\[0\]\.count <= 1/);
    expect(source).toContain('Cannot demote the last platform operator');
  });

  it('updateMembership counts only non-deleted operators', () => {
    // The count query must filter by isPlatformOperator AND exclude soft-deleted users
    expect(source).toMatch(/eq\(users\.isPlatformOperator, true\)/);
    expect(source).toMatch(/isNull\(users\.deletedAt\)/);
  });
});

describe('platform users — deleteUser guards', () => {
  it('deleteUser prevents self-deletion', () => {
    expect(source).toContain('input === ctx.user.id');
    expect(source).toContain('Cannot delete your own account');
  });

  it('deleteUser prevents deleting the last platform operator', () => {
    expect(source).toContain('Cannot delete the last platform operator');
  });

  it('deleteUser checks if target is a platform operator before counting', () => {
    expect(source).toMatch(/target\[0\]\?\.isPlatformOperator/);
  });

  it('deleteUser revokes sessions before soft-deleting', () => {
    // Scope the ordering check to deleteUser's body — other mutations (e.g.
    // revokePendingInvite) also call set({ deletedAt: ... }) to soft-delete
    // orphaned guest users, and a whole-file indexOf would match those first.
    const startIdx = source.indexOf('deleteUser: platformProcedure');
    expect(startIdx, 'deleteUser block not found').toBeGreaterThan(-1);
    const body = source.slice(startIdx);

    const revokeIdx = body.indexOf('await revokeUserSessions(input)');
    const deleteIdx = body.indexOf('set({ deletedAt:');
    expect(revokeIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(revokeIdx).toBeLessThan(deleteIdx);
  });
});

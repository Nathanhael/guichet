import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import { actorFactory, trpcActor } from './actor.js';
import type { Context } from '../../trpc/context.js';

const buildCtx = (overrides: {
  id: string;
  role?: 'agent' | 'support' | 'admin' | 'platform_operator';
  partnerId?: string;
  membershipId?: string;
  departments?: string[];
  isPlatformOperator?: boolean;
  isExternal?: boolean;
}): Context => ({
  req: {} as Context['req'],
  res: {} as Context['res'],
  user: {
    id: overrides.id,
    role: overrides.role ?? 'admin',
    partnerId: overrides.partnerId ?? 'p-1',
    membershipId: overrides.membershipId,
    departments: overrides.departments ?? [],
    isPlatformOperator: overrides.isPlatformOperator ?? false,
    isExternal: overrides.isExternal ?? false,
  },
});

describe('actorFactory', () => {
  it('returns a fully-populated UserActor with sensible defaults', () => {
    const a = actorFactory({ userId: 'u-1' });
    expect(a.kind).toBe('user');
    expect(a.userId).toBe('u-1');
    expect(typeof a.name).toBe('string');
    expect(a.role).toBe('agent');
    expect(typeof a.partnerId).toBe('string');
    expect(a.isPlatformOperator).toBe(false);
    expect(a.isExternal).toBe(false);
    expect(typeof a.lang).toBe('string');
  });

  it('honors overrides verbatim', () => {
    const a = actorFactory({
      userId: 'u-7',
      role: 'admin',
      isExternal: true,
      partnerId: 'p-99',
      lang: 'fr',
      name: 'Alice',
    });
    expect(a.userId).toBe('u-7');
    expect(a.role).toBe('admin');
    expect(a.isExternal).toBe(true);
    expect(a.partnerId).toBe('p-99');
    expect(a.lang).toBe('fr');
    expect(a.name).toBe('Alice');
  });

  it('always sets kind="user" regardless of overrides', () => {
    // @ts-expect-error — test seam: can't override kind
    const a = actorFactory({ userId: 'u-1', kind: 'system' });
    expect(a.kind).toBe('user');
  });
});

describe('trpcActor — happy path', () => {
  it('narrows ctx.user into a typed UserActor', () => {
    const ctx = buildCtx({ id: 'u-1', role: 'admin', partnerId: 'p-1' });
    const a = trpcActor(ctx);
    expect(a.kind).toBe('user');
    expect(a.userId).toBe('u-1');
    expect(a.role).toBe('admin');
    expect(a.partnerId).toBe('p-1');
    expect(a.isExternal).toBe(false);
  });

  it('preserves isExternal=true from context', () => {
    const ctx = buildCtx({ id: 'u-2', isExternal: true });
    const a = trpcActor(ctx);
    expect(a.isExternal).toBe(true);
  });
});

describe('trpcActor — rejection modes', () => {
  it('throws TRPCError UNAUTHORIZED when ctx.user is null', () => {
    const ctx = { req: {}, res: {}, user: null } as unknown as Context;
    expect(() => trpcActor(ctx)).toThrow(TRPCError);
  });

  it('throws TRPCError when partnerId is missing (partner-scoped contract)', () => {
    const ctx = {
      req: {} as Context['req'],
      res: {} as Context['res'],
      user: {
        id: 'u-1',
        role: 'admin',
        partnerId: undefined,
        membershipId: undefined,
        departments: [],
        isPlatformOperator: false,
        isExternal: false,
      },
    } as Context;
    expect(() => trpcActor(ctx)).toThrow(TRPCError);
  });

  it('throws TRPCError FORBIDDEN when capability check fails', () => {
    const ctx = buildCtx({ id: 'u-1', role: 'agent' });
    expect(() => trpcActor(ctx, { capability: 'manage_tenant' })).toThrow(TRPCError);
  });

  it('throws TRPCError FORBIDDEN when destructive_admin requested by B2B guest', () => {
    const ctx = buildCtx({ id: 'u-1', role: 'admin', isExternal: true });
    expect(() => trpcActor(ctx, { capability: 'destructive_admin' })).toThrow(TRPCError);
  });

  it('returns successfully when capability check passes', () => {
    const ctx = buildCtx({ id: 'u-1', role: 'admin' });
    const a = trpcActor(ctx, { capability: 'manage_tenant' });
    expect(a.role).toBe('admin');
  });
});

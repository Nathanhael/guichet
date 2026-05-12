import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Socket } from 'socket.io';
import { actorFactory, trpcActor, socketActor } from './actor.js';
import type { Context } from '../../trpc/context.js';

const buildSocket = (data: Record<string, unknown>): Socket & { __emitted: Array<{ event: string; payload: unknown }> } => {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const socket = {
    data,
    emit: (event: string, payload: unknown) => {
      emitted.push({ event, payload });
      return true;
    },
    __emitted: emitted,
  };
  return socket as unknown as Socket & { __emitted: typeof emitted };
};

const buildCtx = (overrides: {
  id: string;
  role?: 'agent' | 'support' | 'admin' | 'platform_operator';
  partnerId?: string;
  membershipId?: string;
  departments?: string[];
  isPlatformOperator?: boolean;
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
    expect(typeof a.lang).toBe('string');
  });

  it('honors overrides verbatim', () => {
    const a = actorFactory({
      userId: 'u-7',
      role: 'admin',
      partnerId: 'p-99',
      lang: 'fr',
      name: 'Alice',
    });
    expect(a.userId).toBe('u-7');
    expect(a.role).toBe('admin');
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
      },
    } as Context;
    expect(() => trpcActor(ctx)).toThrow(TRPCError);
  });
});

describe('socketActor — happy path', () => {
  it('returns a UserActor when socket.data is fully populated and identified', () => {
    const s = buildSocket({
      identified: true,
      userId: 'u-1',
      role: 'support',
      name: 'Bob',
      partnerId: 'p-1',
      isPlatformOperator: false,
      lang: 'en',
    });
    const a = socketActor(s);
    expect(a).not.toBeNull();
    expect(a?.userId).toBe('u-1');
    expect(a?.role).toBe('support');
    expect(a?.partnerId).toBe('p-1');
  });
});

describe('socketActor — rejection modes', () => {
  it('returns null and emits error when not identified', () => {
    const s = buildSocket({ identified: false });
    const a = socketActor(s);
    expect(a).toBeNull();
    expect(s.__emitted[0]?.event).toBe('error');
  });

  it('returns null and emits error when partnerId is missing', () => {
    const s = buildSocket({
      identified: true,
      userId: 'u-1',
      role: 'support',
      name: 'Bob',
      isPlatformOperator: false,
      lang: 'en',
    });
    const a = socketActor(s);
    expect(a).toBeNull();
    expect(s.__emitted[0]?.event).toBe('error');
  });
});

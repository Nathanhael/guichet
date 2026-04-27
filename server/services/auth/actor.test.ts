import { describe, it, expect } from 'vitest';
import { actorFactory } from './actor.js';

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

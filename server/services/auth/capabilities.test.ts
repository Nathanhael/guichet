import { describe, it, expect } from 'vitest';
import { can, assertCan } from './capabilities.js';
import type { Capability, UserActor, UserRole } from './types.js';

const ALL_ROLES: UserRole[] = ['agent', 'support', 'admin', 'platform_operator'];
const ALL_CAPS: Capability[] = [
  'tenant_admin',
  'platform_admin',
  'support_like',
  'use_support_workflows',
  'manage_tenant',
  'export_tickets',
  'destructive_admin',
];

const actor = (overrides: Partial<UserActor>): UserActor => ({
  kind: 'user',
  userId: 'u-1',
  name: 'Test',
  role: 'agent',
  partnerId: 'p-1',
  isPlatformOperator: false,
  isExternal: false,
  lang: 'en',
  ...overrides,
});

const TRUTH_TABLE: Array<[UserRole, boolean, boolean, Capability, boolean]> = [
  ['agent',             false, false, 'tenant_admin',          false],
  ['support',           false, false, 'tenant_admin',          false],
  ['admin',             false, false, 'tenant_admin',          true],
  ['admin',             false, true,  'tenant_admin',          true],
  ['platform_operator', true,  false, 'tenant_admin',          false],

  ['agent',             false, false, 'platform_admin',        false],
  ['admin',             false, false, 'platform_admin',        false],
  ['platform_operator', true,  false, 'platform_admin',        true],
  ['platform_operator', true,  true,  'platform_admin',        true],

  ['agent',             false, false, 'support_like',          false],
  ['support',           false, false, 'support_like',          true],
  ['admin',             false, false, 'support_like',          true],
  ['platform_operator', true,  false, 'support_like',          true],

  ['agent',             false, false, 'use_support_workflows', false],
  ['support',           false, false, 'use_support_workflows', true],
  ['admin',             false, false, 'use_support_workflows', true],
  ['platform_operator', true,  false, 'use_support_workflows', true],

  ['agent',             false, false, 'manage_tenant',         false],
  ['support',           false, false, 'manage_tenant',         false],
  ['admin',             false, false, 'manage_tenant',         true],
  ['platform_operator', true,  false, 'manage_tenant',         true],

  ['agent',             false, false, 'export_tickets',        false],
  ['support',           false, false, 'export_tickets',        true],
  ['admin',             false, false, 'export_tickets',        true],
  ['platform_operator', true,  false, 'export_tickets',        true],

  ['admin',             false, false, 'destructive_admin',     true],
  ['admin',             false, true,  'destructive_admin',     false],
  ['platform_operator', true,  false, 'destructive_admin',     true],
  ['platform_operator', true,  true,  'destructive_admin',     false],
  ['support',           false, false, 'destructive_admin',     false],
  ['agent',             false, false, 'destructive_admin',     false],
];

describe('capabilities — truth table', () => {
  for (const [role, isPlatformOperator, isExternal, cap, expected] of TRUTH_TABLE) {
    it(`${cap}: role=${role} platform=${isPlatformOperator} external=${isExternal} -> ${expected}`, () => {
      const a = actor({ role, isPlatformOperator, isExternal });
      expect(can(a, cap)).toBe(expected);
    });
  }
});

describe('capabilities — exhaustive cap coverage', () => {
  it('every Capability has a rule (no undefined results)', () => {
    const a = actor({ role: 'admin', isPlatformOperator: false, isExternal: false });
    for (const cap of ALL_CAPS) {
      expect(typeof can(a, cap)).toBe('boolean');
    }
  });

  it('rule signatures stay total over UserRole', () => {
    for (const role of ALL_ROLES) {
      const a = actor({ role });
      for (const cap of ALL_CAPS) {
        expect(typeof can(a, cap)).toBe('boolean');
      }
    }
  });
});

describe('assertCan', () => {
  it('returns silently when the actor has the capability', () => {
    const a = actor({ role: 'admin' });
    expect(() => assertCan(a, 'manage_tenant')).not.toThrow();
  });

  it('throws an Error when the actor lacks the capability', () => {
    const a = actor({ role: 'agent' });
    expect(() => assertCan(a, 'manage_tenant')).toThrow();
  });

  it('throws when destructive_admin is requested by a B2B guest', () => {
    const a = actor({ role: 'admin', isExternal: true });
    expect(() => assertCan(a, 'destructive_admin')).toThrow();
  });
});

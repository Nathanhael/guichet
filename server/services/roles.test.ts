import { describe, expect, it } from 'vitest';
import {
  canAccessPartnerContext,
  canAssignTenantRole,
  canChangePresenceStatus,
  canExportTickets,
  canManageTenant,
  canUseSupportWorkflows,
  isPlatformAdmin,
  isSupportLike,
  isTenantAdmin,
} from './roles.js';

describe('role policy helpers', () => {
  it('recognizes tenant and platform admin concepts', () => {
    expect(isTenantAdmin('admin')).toBe(true);
    expect(isTenantAdmin('support')).toBe(false);
    expect(isPlatformAdmin(true)).toBe(true);
    expect(isPlatformAdmin(false)).toBe(false);
  });

  it('treats support and tenant admin as support-like workflows', () => {
    expect(isSupportLike('support')).toBe(true);
    expect(isSupportLike('admin')).toBe(true);
    expect(isSupportLike('agent')).toBe(false);

    expect(canUseSupportWorkflows('support')).toBe(true);
    expect(canUseSupportWorkflows('admin')).toBe(true);
    expect(canUseSupportWorkflows('agent')).toBe(false);
    expect(canUseSupportWorkflows('agent', true)).toBe(true);
  });

  it('allows tenant admins to assign agent, support, and admin roles', () => {
    expect(canAssignTenantRole('admin', false, 'agent')).toBe(true);
    expect(canAssignTenantRole('admin', false, 'support')).toBe(true);
    expect(canAssignTenantRole('admin', false, 'admin')).toBe(true);
    expect(canAssignTenantRole('admin', false, 'platform_operator')).toBe(false);
    expect(canAssignTenantRole('support', false, 'support')).toBe(false);
    expect(canAssignTenantRole('agent', true, 'admin')).toBe(true);
    expect(canAssignTenantRole('agent', true, 'platform_operator')).toBe(true);
  });

  it('scopes tenant management and exports correctly', () => {
    expect(canManageTenant('admin', false)).toBe(true);
    expect(canManageTenant('support', false)).toBe(false);
    expect(canManageTenant('agent', true)).toBe(true);

    expect(canExportTickets('support', false)).toBe(true);
    expect(canExportTickets('admin', false)).toBe(true);
    expect(canExportTickets('agent', false)).toBe(false);
    expect(canExportTickets('agent', true)).toBe(true);
  });

  it('allows self-status changes and privileged status changes', () => {
    expect(canChangePresenceStatus('agent', 'u1', 'u1', false)).toBe(true);
    expect(canChangePresenceStatus('agent', 'u1', 'u2', false)).toBe(false);
    expect(canChangePresenceStatus('support', 'u1', 'u2', false)).toBe(true);
    expect(canChangePresenceStatus('admin', 'u1', 'u2', false)).toBe(true);
    expect(canChangePresenceStatus('agent', 'u1', 'u2', true)).toBe(true);
  });

  it('requires explicit tenant context unless platform admin', () => {
    expect(canAccessPartnerContext(false, 'tenant-a')).toBe(true);
    expect(canAccessPartnerContext(false, undefined)).toBe(false);
    expect(canAccessPartnerContext(true, undefined)).toBe(true);
  });
});

import {
  canAssignTenantRoleForActor,
  canChangePresenceForActor,
  canAccessPartnerContextForActor,
} from './roles.js';
import type { UserActor } from './auth/types.js';

const userActor = (overrides: Partial<UserActor> = {}): UserActor => ({
  kind: 'user',
  userId: 'u-1',
  name: 'Test',
  role: 'admin',
  partnerId: 'p-1',
  isPlatformOperator: false,
  lang: 'en',
  ...overrides,
});

describe('roles — actor-adapted variants', () => {
  it('canAssignTenantRoleForActor mirrors arg-form result', () => {
    const actor = userActor({ role: 'admin', isPlatformOperator: false });
    expect(canAssignTenantRoleForActor(actor, 'support')).toBe(
      canAssignTenantRole(actor.role, actor.isPlatformOperator, 'support')
    );
  });

  it('canAssignTenantRoleForActor returns false for non-admin actors', () => {
    const actor = userActor({ role: 'support', isPlatformOperator: false });
    expect(canAssignTenantRoleForActor(actor, 'agent')).toBe(false);
  });

  it('canAssignTenantRoleForActor returns true for platform operators', () => {
    const actor = userActor({ role: 'admin', isPlatformOperator: true });
    expect(canAssignTenantRoleForActor(actor, 'admin')).toBe(true);
  });

  it('canChangePresenceForActor mirrors arg-form result', () => {
    const actor = userActor({ role: 'admin' });
    expect(canChangePresenceForActor(actor, 'u-2')).toBe(
      canChangePresenceStatus(actor.role, actor.userId, 'u-2', actor.isPlatformOperator)
    );
  });

  it('canChangePresenceForActor allows self-status changes for any role', () => {
    const actor = userActor({ role: 'agent', userId: 'u-1' });
    expect(canChangePresenceForActor(actor, 'u-1')).toBe(true);
  });

  it('canAccessPartnerContextForActor returns true for matching partner', () => {
    const actor = userActor({ partnerId: 'p-1' });
    expect(canAccessPartnerContextForActor(actor)).toBe(
      canAccessPartnerContext(actor.isPlatformOperator, actor.partnerId)
    );
  });

  it('canAccessPartnerContextForActor honors platform operators', () => {
    const actor = userActor({ isPlatformOperator: true, partnerId: 'p-7' });
    expect(canAccessPartnerContextForActor(actor)).toBe(true);
  });
});

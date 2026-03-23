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

  it('allows tenant admins to assign only agent and support roles', () => {
    expect(canAssignTenantRole('admin', false, 'agent')).toBe(true);
    expect(canAssignTenantRole('admin', false, 'support')).toBe(true);
    expect(canAssignTenantRole('admin', false, 'admin')).toBe(false);
    expect(canAssignTenantRole('support', false, 'agent')).toBe(false);
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

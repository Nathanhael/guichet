import type { Capability, UserActor } from './types.js';
import {
  isTenantAdmin,
  isPlatformAdmin,
  isSupportLike,
  canUseSupportWorkflows,
  canManageTenant,
  canExportTickets,
} from '../roles.js';

type Rule = (actor: UserActor) => boolean;

export const RULES: Record<Capability, Rule> = {
  tenant_admin: (a) => isTenantAdmin(a.role),
  platform_admin: (a) => isPlatformAdmin(a.isPlatformOperator),
  support_like: (a) => isSupportLike(a.role) || isPlatformAdmin(a.isPlatformOperator),
  use_support_workflows: (a) => canUseSupportWorkflows(a.role, a.isPlatformOperator),
  manage_tenant: (a) => canManageTenant(a.role, a.isPlatformOperator),
  export_tickets: (a) => canExportTickets(a.role, a.isPlatformOperator),
  destructive_admin: (a) =>
    !a.isExternal && (isTenantAdmin(a.role) || isPlatformAdmin(a.isPlatformOperator)),
  audit_read: (a) =>
    !a.isExternal && (isTenantAdmin(a.role) || isPlatformAdmin(a.isPlatformOperator)),
  ai_config_read: (a) =>
    !a.isExternal && (isTenantAdmin(a.role) || isPlatformAdmin(a.isPlatformOperator)),
};

export function can(actor: UserActor, cap: Capability): boolean {
  return RULES[cap](actor);
}

export class CapabilityDeniedError extends Error {
  constructor(public readonly capability: Capability) {
    super(`Actor does not have capability: ${capability}`);
    this.name = 'CapabilityDeniedError';
  }
}

export function assertCan(actor: UserActor, cap: Capability): void {
  if (!RULES[cap](actor)) {
    throw new CapabilityDeniedError(cap);
  }
}

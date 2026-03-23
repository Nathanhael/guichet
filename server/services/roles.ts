import type { UserRole } from '../types/index.js';

export function isTenantAdmin(role: UserRole): boolean {
  return role === 'admin';
}

export function isPlatformAdmin(isPlatformOperator: boolean): boolean {
  return isPlatformOperator;
}

export function isSupportLike(role: UserRole): boolean {
  return role === 'support' || isTenantAdmin(role);
}

export function canAssignTenantRole(actorRole: UserRole, actorIsPlatformOperator: boolean, targetRole: UserRole): boolean {
  if (actorIsPlatformOperator) {
    return true;
  }

  if (!isTenantAdmin(actorRole)) {
    return false;
  }

  return targetRole === 'agent' || targetRole === 'support';
}

export function canManageTenant(actorRole: UserRole, actorIsPlatformOperator: boolean): boolean {
  return actorIsPlatformOperator || isTenantAdmin(actorRole);
}

export function canUseSupportWorkflows(role: UserRole, isPlatformOperator = false): boolean {
  return isPlatformOperator || isSupportLike(role);
}

export function canExportTickets(role: UserRole, isPlatformOperator = false): boolean {
  return canUseSupportWorkflows(role, isPlatformOperator);
}

export function canChangePresenceStatus(actorRole: UserRole, actorId: string, targetUserId: string, actorIsPlatformOperator = false): boolean {
  if (actorId === targetUserId) {
    return true;
  }

  return canUseSupportWorkflows(actorRole, actorIsPlatformOperator);
}

export function canAccessPartnerContext(isPlatformOperator: boolean, partnerId?: string | null): boolean {
  return isPlatformOperator || !!partnerId;
}

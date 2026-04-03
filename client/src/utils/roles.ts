import type { User, UserRole } from '../types';

export function isTenantAdmin(role: UserRole | undefined | null): boolean {
  return role === 'admin';
}

export function isPlatformAdmin(user: Pick<User, 'isPlatformOperator'> | null | undefined): boolean {
  return !!user?.isPlatformOperator;
}

export function isSupportLike(role: UserRole | undefined | null): boolean {
  return role === 'support' || role === 'platform_operator' || isTenantAdmin(role);
}

export function getRoleConcept(role: UserRole | undefined | null, isPlatformOperator = false): 'agent' | 'support' | 'tenant_admin' | 'platform_admin' | 'unknown' {
  if (isPlatformOperator) return 'platform_admin';
  if (role === 'admin') return 'tenant_admin';
  if (role === 'support') return 'support';
  if (role === 'agent') return 'agent';
  return 'unknown';
}

export function getRoleDisplayName(role: UserRole | undefined | null, isPlatformOperator = false): string {
  const concept = getRoleConcept(role, isPlatformOperator);

  switch (concept) {
    case 'tenant_admin':
      return 'Tenant Admin';
    case 'platform_admin':
      return 'Platform Admin';
    case 'support':
      return 'Support';
    case 'agent':
      return 'Agent';
    default:
      return 'Unknown';
  }
}

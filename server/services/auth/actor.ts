import type { UserActor } from './types.js';

export function actorFactory(
  overrides: Partial<Omit<UserActor, 'kind'>> & { userId: string }
): UserActor {
  return {
    kind: 'user',
    userId: overrides.userId,
    name: overrides.name ?? 'Test User',
    role: overrides.role ?? 'agent',
    partnerId: overrides.partnerId ?? 'p-test',
    isPlatformOperator: overrides.isPlatformOperator ?? false,
    isExternal: overrides.isExternal ?? false,
    lang: overrides.lang ?? 'en',
  };
}

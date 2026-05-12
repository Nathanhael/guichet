export type UserRole = 'agent' | 'support' | 'admin' | 'platform_operator';

export interface UserActor {
  kind: 'user';
  userId: string;
  name: string;
  role: UserRole;
  partnerId: string;
  isPlatformOperator: boolean;
  lang: string;
}

export interface SystemActor {
  kind: 'system';
  id: '__system__';
  name: 'System';
}

export type Actor = UserActor | SystemActor;

export const SYSTEM_ACTOR: SystemActor = {
  kind: 'system',
  id: '__system__',
  name: 'System',
};

export function isUserActor(actor: Actor): actor is UserActor {
  return actor.kind === 'user';
}

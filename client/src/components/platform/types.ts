export type PlatformTab = 'partners' | 'users' | 'invites' | 'sso' | 'ai-security' | 'health' | 'audit' | 'archive';
export type UserRole = 'agent' | 'support' | 'admin' | 'platform_operator';

export interface PartnerMembership {
  id: string;
  partnerId: string;
  partnerName: string;
  role: string;
}

export type ImprovementMode = 'off' | 'optional' | 'forced';

export interface AiFeatures {
  messageImprovement?: ImprovementMode;
  translation?: boolean;
  queueLangAwareness?: boolean;
  voiceTranscription?: boolean;
  cannedTranslation?: boolean;
}

export interface Partner {
  id: string;
  name: string;
  industry: string | null;
  status: string;
  departments?: unknown;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  aiEnabled?: boolean | null;
  aiFeatures?: AiFeatures | unknown;
  [key: string]: unknown;
}

export interface GlobalUser {
  id: string;
  name: string;
  email: string | null;
  isPlatformOperator?: boolean | null;
  deletedAt?: string | null;
  lastActiveAt?: string | null;
  externalId?: string | null;
  lang?: string | null;
  createdAt?: string;
  updatedAt?: string;
  partnerMemberships?: PartnerMembership[];
  [key: string]: unknown;
}

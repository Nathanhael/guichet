export type PlatformTab = 'partners' | 'users' | 'sso' | 'security' | 'health' | 'config' | 'audit' | 'archive';
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
  chatSummarization?: boolean;
  translation?: boolean;
  sentimentDetection?: boolean;
  autoSummarizeOnClose?: boolean;
}

export interface Partner {
  id: string;
  name: string;
  logoUrl: string | null;
  industry: string | null;
  status: string;
  authMethod: 'local' | 'sso' | 'both';
  departments?: unknown;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  businessHoursStart?: string | null;
  businessHoursEnd?: string | null;
  slaConfig?: unknown;
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
  password?: string | null;
  lang?: string | null;
  mfaEnabledAt?: string | null;
  lockedUntil?: string | null;
  failedLoginAttempts?: number | null;
  createdAt?: string;
  updatedAt?: string;
  partnerMemberships?: PartnerMembership[];
  [key: string]: unknown;
}

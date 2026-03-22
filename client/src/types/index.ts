export type UserRole = 'agent' | 'support' | 'admin' | 'platform_operator';

export interface ThemeConfig {
  glassBlur?: string;
  glassOpacity?: string;
  brandPrimary?: string;
  brandSecondary?: string;
  accentColor?: string;
  borderRadius?: string;
}

export interface PartnerManifest {
  industry: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  ref1Label: string;
  ref2Label: string;
  departments: { id: string; name: string; description?: string }[];
  aiRules?: string;
  themeConfig?: ThemeConfig;
  ollamaModel?: string;
}

export interface Membership {
  id: string;
  partnerId: string;
  partnerName: string;
  role: UserRole;
  departments: string[];
  dept?: string;
  manifest: PartnerManifest;
  avatarUrl?: string;
  status?: 'active' | 'inactive';
}

export interface User {
  id: string;
  name: string;
  role: UserRole;
  lang: 'nl' | 'fr' | 'en';
  isPlatformOperator: boolean;
  avatarUrl?: string;
  departments?: string[];
  dept?: string;
}

export interface AppConfig {
  businessHoursStart: string;
  businessHoursEnd: string;
  businessHoursTimezone: string;
  uploadMaxSize: number;
  uploadAllowedTypes: string[];
}

export interface ZenSettings {
  autoBionic: boolean;
  notificationShield: boolean;
}

export interface CannedResponse {
  id: string;
  shortcut: string;
  text: string;
}

export interface Label {
  id: string;
  name: string;
  text?: string; // fallback
  color: string;
}

export interface Ticket {
  id: string;
  dept: string;
  agentId: string;
  agentName: string;
  agentLang: string;
  ref1?: string | null;
  ref2?: string | null;
  cdbId?: string | null; // legacy
  dareRef?: string | null; // legacy
  status: 'open' | 'active' | 'closed';
  supportId?: string | null;
  supportName?: string | null;
  supportLang?: string | null;
  supportJoinedAt?: string | null;
  createdAt: string;
  closedAt?: string | null;
  closingNotes?: string | null;
  closedBy?: string | null;
  participants: any[];
  labels: string[];
  summary?: string | null;
}

export interface Message {
  id: string;
  ticketId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  senderLang: string;
  originalText: string;
  improvedText: string;
  processedText: string;
  text?: string;
  mediaUrl?: string | null;
  whisper: boolean | number;
  system: boolean | number;
  translationSkipped: boolean | number;
  fallback: boolean | number;
  timestamp: string;
  createdAt?: string; // alias/legacy
  readAt?: string | null;
  reactions: any;
  pending?: boolean;
}

export interface OnlineSupport {
  userId: string;
  name: string;
  status: string;
}

export interface RatingPromptData {
  ticketId: string;
  supportId: string;
  supportName: string;
}

import { AuthSlice } from '../store/slices/authSlice';
import { TicketSlice } from '../store/slices/ticketSlice';
import { MessageSlice } from '../store/slices/messageSlice';
import { UISlice } from '../store/slices/uiSlice';
import { ConfigSlice } from '../store/slices/configSlice';
import { RatingSlice } from '../store/slices/ratingSlice';

export interface StoreState extends AuthSlice, TicketSlice, MessageSlice, UISlice, ConfigSlice, RatingSlice {}

export interface StatsTrend {
  date: string;
  count: number;
}

export interface SupportStat {
  name: string;
  total: number;
  avgRating?: number;
  depts?: string[];
  deptRatings?: Record<string, number>;
  trend?: StatsTrend[];
  sentiment?: string;
  load?: number;
  slaAdherence?: number;
}

export interface AgentStat {
  name: string;
  total: number;
  trend?: StatsTrend[];
}

export interface HourlyStat {
  hour: number;
  tickets: number;
  support: number;
  slaHealth: number;
  staffing?: number;
  demand?: number;
  count?: number; // for distribution
  avgResolutionTime?: number;
}

export interface LLMSummaryData {
  sentiment: 'Positive' | 'Neutral' | 'Negative' | 'Frustrated' | 'Mixed';
  summary: string;
  questions?: string[];
  updatedAt: string;
}

export interface SupportRatingStat {
  name: string;
  total: number;
  avgRating?: number;
  depts?: string[];
  deptRatings?: Record<string, number>;
}

export interface HourPoint {
  hour: number;
  count: number;
}

export interface SupportPerformanceTrend {
  name: string;
  trend?: { date: string; count: number }[];
}

export interface DeptRating {
  avg: number;
  count: number;
}

export interface AdminStats {
  total: number;
  avgResponseMinutes: number;
  avgDurationMinutes: number;
  p95ResponseMinutes?: number;
  reopenRate?: number;
  sentimentScore?: number;
  avgRating: number;
  abandonedCount: number;
  slaHealth: number;
  oldestWaitMinutes: number;
  waitingOver3: number;
  deptCounts: Record<string, number>;
  deptSla?: Record<string, number>;
  trendGranularity: 'daily' | 'weekly' | 'monthly';
  dailyTrend: { date: string; total: number; deptCounts: Record<string, number> }[];
  ratingsByDept?: Record<string, DeptRating>;
  supportStats: { name: string; total: number; today: number }[];
  agentStats: { name: string; total: number; today: number }[];
  hourlyDistribution: { hour: number; count: number }[];
  hourlyStaffing?: { hour: number; tickets: number; support: number; slaHealth: number }[];
  daySummary?: Record<string, string[]>;
  previousPeriod?: Partial<AdminStats>;
}

export interface Statistics extends AdminStats {}

export interface FeedbackItem {
  id: string;
  userName: string;
  role: string;
  createdAt: string;
  text: string;
  treated: boolean | number;
}

export interface Rating {
  id: string;
  rating: number;
  ticketId: string;
  supportId: string | null;
  supportName?: string | null;
  agentId: string;
  comment?: string | null;
  createdAt: string;
}

export interface TopicAlert {
  id: string;
  partnerId: string;
  dept: string;
  topic: string;
  summary: string;
  severity: 'low' | 'medium' | 'high';
  ticketCount: number;
  status: 'active' | 'acknowledged' | 'resolved';
  createdAt: string;
  resolvedAt?: string | null;
}

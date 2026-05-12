export type UserRole = 'agent' | 'support' | 'admin' | 'platform_operator';

export interface ThemeConfig {
  brandPrimary?: string;
  brandSecondary?: string;
  accentColor?: string;
}

export interface DepartmentSlaConfig {
  enabled: boolean;
  firstResponseMinutes: number;
  warnAtPercent: number; // 50 | 75 | 90
}

export interface Department {
  id: string;
  name: string;
  description?: string;
  referenceFields?: Array<{ label: string; optional?: boolean }>;
  sla?: DepartmentSlaConfig;
}

export interface PartnerManifest {
  industry: string;
  primaryColor?: string;
  secondaryColor?: string;
  departments: { id: string; name: string; description?: string; welcomeMessage?: string; referenceFields?: Array<{ label: string; optional?: boolean }> }[];
  aiRules?: string;
  themeConfig?: ThemeConfig;
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

export type BusinessHoursDayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface BusinessHoursWindow {
  start: string;
  end: string;
}

export interface BusinessHoursDaySchedule {
  closed: boolean;
  windows: BusinessHoursWindow[];
}

export interface BusinessHoursException {
  id: string;
  date: string;
  closed?: boolean;
  windows?: BusinessHoursWindow[];
  note?: string;
}

export interface BusinessHoursSchedule {
  version: 1;
  timezone: string;
  weekly: Record<BusinessHoursDayKey, BusinessHoursDaySchedule>;
  exceptions: BusinessHoursException[];
}

export interface BusinessHoursStatus {
  isOpen: boolean;
  timezone: string;
  source: 'weekly' | 'exception' | 'default';
  matchedWindow?: BusinessHoursWindow;
  activeExceptionNote?: string;
  nextOpenAt?: string;
  nextCloseAt?: string;
  evaluatedAt: string;
  message?: string;
}

export interface AccessibilityPrefs {
  dyslexicMode?: boolean;
  bionicReading?: boolean;
  monochromeMode?: boolean;
  focusMode?: boolean;
}

export interface User {
  id: string;
  name: string;
  email?: string;
  role: UserRole;
  lang: 'nl' | 'fr' | 'en';
  isPlatformOperator: boolean;
  avatarUrl?: string;
  departments?: string[];
  dept?: string;
  accessibilityPrefs?: AccessibilityPrefs;
}

export interface AppConfig {
  businessHoursSchedule: BusinessHoursSchedule | null;
  businessHoursStatus?: BusinessHoursStatus;
  uploadMaxSize: number;
  uploadAllowedTypes: string[];
}

export interface ZenSettings {
  autoBionic: boolean;
  notificationShield: boolean;
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Participant {
  id: string;
  name: string;
  role?: string;
  lang?: string;
}

export interface Ticket {
  id: string;
  dept: string;
  agentId: string;
  agentName: string | null;
  agentLang: string | null;
  references?: Array<{ label: string; value: string }> | null;
  status: 'open' | 'pending' | 'closed' | 'resolved';
  supportId?: string | null;
  supportName?: string | null;
  supportLang?: string | null;
  supportJoinedAt?: string | null;
  queueEnteredAt?: string;
  createdAt: string;
  updatedAt?: string;
  closedAt?: string | null;
  closingNotes?: string | null;
  closedBy?: string | null;
  participants: Participant[];
  labels: string[];
  reopened?: boolean | null;
  reopenCount?: number | null;
  /**
   * Server-supplied enrichment populated only for archive-style listings
   * (paginated terminal-status queries). Undefined elsewhere; optional so
   * existing call sites don't need to widen their fixtures.
   *   firstMessage = first non-system, non-deleted message text in the thread
   *   rating       = CSAT score 1-5 if the customer left one
   */
  firstMessage?: string | null;
  rating?: number | null;
}

export interface Message {
  id: string;
  ticketId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  senderLang: string;
  /**
   * Live avatar URL joined from users.avatarUrl at fetch time. Null when
   * the sender has no Entra photo synced or was deleted. Omitted on
   * optimistic/pending client-side messages.
   */
  senderAvatarUrl?: string | null;
  originalText: string;
  improvedText: string;
  processedText: string;
  text?: string;
  mediaUrl?: string | null;
  attachments?: Array<{ url: string; name: string; mimeType: string; size: number }> | null;
  whisper: boolean | number;
  system: boolean | number;
  translationSkipped: boolean | number;
  fallback: boolean | number;
  timestamp: string;
  createdAt?: string; // alias/legacy
  deliveredAt?: string | null;
  readAt?: string | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  /**
   * Stamped by the server when the agent applies an AI-improved draft to
   * an outgoing message (slice 7). Drives the ✨ AI badge in Message.
   * Optional for backward compatibility with cached pre-migration messages.
   */
  improvedAt?: string | null;
  replyToId?: string | null;
  replyTo?: { id: string; senderName: string; senderLang?: string | null; text: string; mediaUrl?: string | null } | null;
  reactions: Record<string, string[]>;
  linkPreviews?: Array<{ url: string; title?: string; description?: string; image?: string; siteName?: string }> | null;
  translations?: Record<string, string>;
  pending?: boolean;
  /** Client-generated ID echoed back by server for optimistic reconciliation */
  localId?: string;
}

export interface OnlineSupport {
  userId: string;
  name: string;
  status: 'online' | 'away';
  role?: string;
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
  load?: number;
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
  staffing?: number;
  demand?: number;
  count?: number; // for distribution
  avgResolutionTime?: number;
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
  avgRating: number;
  abandonedCount: number;
  oldestWaitMinutes: number;
  waitingOver3: number;
  deptCounts: Record<string, number>;
  trendGranularity: 'daily' | 'weekly' | 'monthly';
  dailyTrend: { date: string; total: number; deptCounts: Record<string, number> }[];
  ratingsByDept?: Record<string, DeptRating>;
  supportStats: { name: string; total: number; today: number }[];
  agentStats: { name: string; total: number; today: number }[];
  hourlyDistribution: { hour: number; count: number }[];
  hourlyStaffing?: { hour: number; tickets: number; support: number }[];
  daySummary?: Record<string, string[]>;
  previousPeriod?: Partial<AdminStats>;
}

export type Statistics = AdminStats;

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


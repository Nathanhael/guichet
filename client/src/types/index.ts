export type UserRole = 'agent' | 'support' | 'admin' | 'platform_operator';

export interface ThemeConfig {
  brandPrimary?: string;
  brandSecondary?: string;
  accentColor?: string;
}

export interface PartnerManifest {
  industry: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  departments: { id: string; name: string; description?: string; welcomeMessage?: string; referenceFields?: Array<{ label: string; optional?: boolean }> }[];
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
  /**
   * True when the user is an Azure B2B guest (external partner employee).
   * Drives GUEST badge rendering and read-only handling in admin UI.
   * Populated by the server from `users.isExternal` via `trpc.user.me`.
   */
  isExternal?: boolean;
  avatarUrl?: string;
  departments?: string[];
  dept?: string;
  accessibilityPrefs?: AccessibilityPrefs;
}

export interface AppConfig {
  businessHoursStart: string;
  businessHoursEnd: string;
  businessHoursTimezone: string;
  businessHoursSchedule?: BusinessHoursSchedule;
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
  /**
   * Azure B2B guest flag snapshot at join time (denormalized on
   * `tickets.participants`). Drives the amber ring around guest avatars
   * in ChatHeader. Always written by `assignSupport`; kept optional only
   * so legacy fixtures that don't include the field still parse (reseed
   * to refresh). Falsy means not-a-guest.
   */
  isExternal?: boolean;
}

export interface Ticket {
  id: string;
  dept: string;
  agentId: string;
  agentName: string | null;
  agentLang: string | null;
  references?: Array<{ label: string; value: string }> | null;
  cdbId?: string | null; // legacy
  dareRef?: string | null; // legacy
  status: 'open' | 'pending' | 'closed';
  supportId?: string | null;
  supportName?: string | null;
  supportLang?: string | null;
  supportJoinedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  closedAt?: string | null;
  closingNotes?: string | null;
  closedBy?: string | null;
  participants: Participant[];
  labels: string[];
  summary?: string | null;
  reopened?: boolean;
  reopenCount?: number;
}

export interface Message {
  id: string;
  ticketId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  senderLang: string;
  /**
   * Azure B2B guest flag denormalized from users.isExternal at insert time.
   * Drives the GUEST badge in MessageBubble. Optional to stay backward
   * compatible with older cached messages whose payloads were written
   * before migration 0006 — treat undefined as false.
   */
  senderIsExternal?: boolean;
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
  replyToId?: string | null;
  replyTo?: { id: string; senderName: string; text: string; mediaUrl?: string | null } | null;
  reactions: Record<string, string[]>;
  linkPreviews?: Array<{ url: string; title?: string; description?: string; image?: string; siteName?: string }> | null;
  pending?: boolean;
  /** Client-generated ID echoed back by server for optimistic reconciliation */
  localId?: string;
}

export interface OnlineSupport {
  userId: string;
  name: string;
  status: 'online' | 'away';
  role?: string;
  /** Azure B2B guest flag — drives the GUEST badge in QueueSidebar + AdminTeam. */
  isExternal?: boolean;
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
  sentimentByDept?: Record<string, { avg: number | null; count: number }>;
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

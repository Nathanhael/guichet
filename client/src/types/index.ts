export type UserRole = 'agent' | 'expert' | 'admin';

export interface PartnerManifest {
  industry: string;
  primaryColor: string;
  secondaryColor: string;
  ref1Label: string;
  ref2Label: string;
  departments: { id: string; label: string }[];
  aiRules?: string;
}

export interface Membership {
  id: string;
  partnerId: string;
  partnerName: string;
  role: UserRole | 'manager' | 'platform_operator';
  dept?: string;
  manifest: PartnerManifest;
}

export interface User {
  id: string;
  name: string;
  lang: 'nl' | 'fr' | 'en';
  isPlatformOperator: boolean;
}

export interface StoreState {
  user: User | null;
  memberships: Membership[];
  activeMembershipId: string | null;
  activePartnerId: string | null;
  token: string | null;
  appConfig: AppConfig | null;
  dyslexicMode: boolean;
  bionicReading: boolean;
  highContrastMode: boolean;
  focusMode: boolean;
  zenSettings: ZenSettings;
  selectedLang: string | null;
  cannedResponses: CannedResponse[];
  notificationsEnabled: boolean;
  tickets: Ticket[];
  archivedTickets: Ticket[];
  messages: Record<string, Message[]>;
  onlineExperts: OnlineExpert[];
  typingUsers: Record<string, Record<string, boolean>>;
  activeTicketId: string | null;
  expertOpenTickets: string[];
  ratingPrompt: RatingPromptData | null;
  unreadTickets: Set<string>;
  agentOnline: Record<string, boolean>;
  businessHoursOpen: boolean;
  darkMode: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  allLabels: Label[];
  queuePosition: { position: number; etaMins: number } | null;

  setMemberships: (memberships: Membership[]) => void;
  setActiveMembershipId: (id: string | null) => void;
  setCannedResponses: (responses: CannedResponse[]) => void;
  updateMessageState: (ticketId: string, messageId: string, updates: Partial<Message>) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setAppConfig: (config: AppConfig) => void;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  logout: () => void;
  setTickets: (tickets: Ticket[]) => void;
  setArchivedTickets: (archived: Ticket[]) => void;
  addTicket: (ticket: Ticket) => void;
  updateTicket: (ticketId: string, updates: Partial<Ticket>) => void;
  toggleTicketLabel: (ticketId: string, labelId: string) => void;
  setMessages: (ticketId: string, messages: Message[]) => void;
  addMessage: (ticketId: string, message: Message) => void;
  setOnlineExperts: (list: OnlineExpert[]) => void;
  setTyping: (ticketId: string, name: string, isTyping: boolean) => void;
  setActiveTicketId: (id: string | null) => void;
  addExpertOpenTicket: (ticketId: string) => void;
  removeExpertOpenTicket: (ticketId: string) => void;
  setRatingPrompt: (data: RatingPromptData | null) => void;
  clearRatingPrompt: () => void;
  updateMessageReaction: (ticketId: string, messageId: string, reactions: Record<string, string[]>) => void;
  markUnread: (ticketId: string) => void;
  clearUnread: (ticketId: string) => void;
  setAgentOnline: (ticketId: string, online: boolean) => void;
  setBusinessHoursOpen: (open: boolean) => void;
  toggleDarkMode: () => void;
  toggleDyslexicMode: () => void;
  toggleBionicReading: () => void;
  toggleHighContrastMode: () => void;
  toggleFocusMode: () => void;
  updateZenSettings: (updates: Partial<ZenSettings>) => void;
  setSelectedLang: (lang: string) => void;
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'reconnecting') => void;
  setAllLabels: (labels: Label[]) => void;
  removeLabelGlobally: (labelId: string) => void;
  addLabelGlobally: (label: Label) => void;
  setQueuePosition: (pos: { position: number; etaMins: number } | null) => void;
}

export interface StatsTrend {
  date: string;
  count: number;
}

export interface ExpertStat {
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
  experts: number;
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

export interface ExpertRatingStat {
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

export interface ExpertPerformanceTrend {
  name: string;
  trend?: { date: string; count: number }[];
}

export interface AgentStat {
  name: string;
  total: number;
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
  dscCount: number;
  fotCount: number;
  globalDscCount?: number;
  globalFotCount?: number;
  deptSla?: Record<string, number>;
  trendGranularity: 'daily' | 'weekly' | 'monthly';
  dailyTrend: { date: string; total: number; dsc: number; fot: number }[];
  ratingsByDept?: Record<string, DeptRating>;
  expertStats: { name: string; total: number; today: number }[];
  agentStats: { name: string; total: number; today: number }[];
  hourlyDistribution: { hour: number; count: number }[];
  hourlyStaffing?: { hour: number; tickets: number; experts: number; slaHealth: number }[];
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
  expertId: string;
  agentId: string;
  comment?: string;
  createdAt: string;
}

import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import { useStoreShallow } from '../store/useStore';
import { useT } from '../i18n';
import UserMenuChip from '../components/ui/UserMenuChip';
import AdminTickets from '../components/admin/AdminTickets';
import AdminArchive from '../components/admin/AdminArchive';
import AdminFeedback from '../components/admin/AdminFeedback';
import AdminLabels from '../components/admin/AdminLabels';
import AdminCannedResponses from '../components/admin/AdminCannedResponses';
// DISABLED_FEATURE: Knowledge Base, Webhooks — hidden until production-ready
// import AdminKnowledgeBase from '../components/admin/AdminKnowledgeBase';
// import AdminWebhooks from '../components/admin/AdminWebhooks';
import AdminBusinessHours from '../components/admin/AdminBusinessHours';
import AdminDepartments from '../components/admin/AdminDepartments';
import AdminAlerts from '../components/admin/AdminAlerts';
import AdminTeam from '../components/admin/AdminTeam';
import AdminAuditLog from '../components/admin/AdminAuditLog';
import PartnerUnavailable from '../components/PartnerUnavailable';
import {
  Flame,
  Building2,
  Users,
  FileText,
  LayoutDashboard,
  Star,
  MessageSquare,
  Archive,
  Smile,
  Clock,
  Tag,
  Zap,
} from 'lucide-react';

const AdminStats = lazy(() => import('../components/admin/AdminStats'));
const AdminSatisfaction = lazy(() => import('../components/admin/AdminSatisfaction'));

const LoadingFallback = () => (
  <div className="p-8 text-[13px] text-[var(--color-ink-muted)]">Loading…</div>
);

type AdminTab =
  | 'dashboard'
  | 'satisfaction'
  | 'alerts'
  | 'team'
  | 'business_hours'
  | 'departments'
  | 'tickets'
  | 'archive'
  | 'audit_log'
  | 'feedback'
  | 'labels'
  | 'canned_responses';
// DISABLED_FEATURE: removed 'knowledge_base' | 'webhooks'

const SIDEBAR_WIDTH_KEY = 'guichet.adminSidebarWidth';
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 240;

function readInitialWidth(): number {
  if (typeof window === 'undefined') return SIDEBAR_DEFAULT;
  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) return SIDEBAR_DEFAULT;
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, parsed));
}

export default function AdminView() {
  const { user, memberships, activeMembershipId } = useStoreShallow(s => ({
    user: s.user,
    memberships: s.memberships,
    activeMembershipId: s.activeMembershipId,
  }));
  const t = useT();
  const [view, setView] = useState<AdminTab>('dashboard');
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readInitialWidth());
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const widthRef = useRef(sidebarWidth);

  const handleDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    dragStateRef.current = { startX: e.clientX, startWidth: widthRef.current };
    e.preventDefault();
  }, []);

  useEffect(() => {
    function handleMove(e: MouseEvent) {
      const drag = dragStateRef.current;
      if (!drag) return;
      const next = drag.startWidth + (e.clientX - drag.startX);
      const clamped = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, next));
      widthRef.current = clamped;
      setSidebarWidth(clamped);
    }
    function handleUp() {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      try { window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(widthRef.current)); } catch { /* storage disabled */ }
    }
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, []);

  if (!user) return null;

  // Guard: partner was deleted or membership is stale
  const activeMembership = (memberships || []).find(m => m.id === activeMembershipId);
  if (activeMembershipId && !activeMembership && !user.isPlatformOperator) return <PartnerUnavailable />;

  const NavButton = ({ id, label, icon }: { id: AdminTab; label: string; icon: React.ReactNode }) => {
    const active = view === id;
    return (
      <button
        onClick={() => setView(id)}
        title={label}
        className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-[var(--radius-btn)] text-[13px] font-medium transition-colors ${
          active
            ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
            : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]'
        }`}
      >
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
    );
  };

  const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] px-3 pt-4 pb-1.5 select-none">
      {children}
    </div>
  );

  return (
    <ErrorBoundary>
      <div className="h-screen flex flex-row overflow-hidden bg-[var(--color-bg)] text-[var(--color-ink)]">
        <aside
          className="relative h-full bg-[var(--color-bg-surface)] border-r border-[var(--color-border)] flex flex-col flex-shrink-0"
          style={{ width: sidebarWidth }}
        >
          <div className="px-2 pt-3 pb-2 border-b border-[var(--color-border)]">
            <UserMenuChip />
          </div>

          <nav className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-3">
            <SectionLabel>Overview</SectionLabel>
            <div className="flex flex-col gap-0.5">
              <NavButton id="dashboard" label={t('dashboard')} icon={<LayoutDashboard className="h-4 w-4" />} />
              <NavButton id="satisfaction" label="Satisfaction" icon={<Star className="h-4 w-4" />} />
              <NavButton id="alerts" label="Alerts" icon={<Flame className="h-4 w-4" />} />
            </div>

            <SectionLabel>Operations</SectionLabel>
            <div className="flex flex-col gap-0.5">
              <NavButton id="tickets" label={t('active_tickets')} icon={<MessageSquare className="h-4 w-4" />} />
              <NavButton id="archive" label={t('archive')} icon={<Archive className="h-4 w-4" />} />
              <NavButton id="audit_log" label="Audit Log" icon={<FileText className="h-4 w-4" />} />
              <NavButton id="feedback" label={t('feedback_and_ratings')} icon={<Smile className="h-4 w-4" />} />
            </div>

            <SectionLabel>Team</SectionLabel>
            <div className="flex flex-col gap-0.5">
              <NavButton id="team" label="Team" icon={<Users className="h-4 w-4" />} />
              <NavButton id="departments" label="Departments" icon={<Building2 className="h-4 w-4" />} />
            </div>

            <SectionLabel>Configuration</SectionLabel>
            <div className="flex flex-col gap-0.5">
              <NavButton id="business_hours" label="Business Hours" icon={<Clock className="h-4 w-4" />} />
              <NavButton id="labels" label={t('labels')} icon={<Tag className="h-4 w-4" />} />
              <NavButton id="canned_responses" label={t('canned_responses') || 'Quick Replies'} icon={<Zap className="h-4 w-4" />} />
              {/* DISABLED_FEATURE: Knowledge Base, Webhooks — NavButtons hidden until production-ready */}
            </div>
          </nav>

          <div
            onMouseDown={handleDragStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-[var(--color-accent-soft)] transition-colors"
          />
        </aside>

        <main
          className={`flex-1 bg-[var(--color-bg)] custom-scrollbar ${
            ['tickets', 'archive'].includes(view) ? 'p-0 overflow-hidden' : 'p-6 overflow-y-auto'
          }`}
        >
          {view === 'dashboard' && <Suspense fallback={<LoadingFallback />}><AdminStats /></Suspense>}
          {view === 'satisfaction' && <Suspense fallback={<LoadingFallback />}><AdminSatisfaction /></Suspense>}
          {view === 'team' && <AdminTeam />}
          {view === 'alerts' && <AdminAlerts />}
          {view === 'business_hours' && <AdminBusinessHours />}
          {view === 'departments' && <AdminDepartments />}
          {view === 'tickets' && <AdminTickets />}
          {view === 'archive' && <AdminArchive />}
          {view === 'audit_log' && <AdminAuditLog />}
          {view === 'feedback' && <AdminFeedback />}
          {view === 'labels' && <AdminLabels />}
          {view === 'canned_responses' && <AdminCannedResponses />}
          {/* DISABLED_FEATURE: Knowledge Base, Webhooks — tab panels hidden until production-ready */}
        </main>
      </div>
    </ErrorBoundary>
  );
}

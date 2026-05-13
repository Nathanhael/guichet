import React, { lazy, Suspense, useState } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import { useStoreShallow } from '../store/useStore';
import { useT } from '../i18n';
import { useResizableSidebar } from '../hooks/useResizableSidebar';
import UserMenuChip from '../components/ui/UserMenuChip';
import { NavButton, NavGroupLabel } from '../components/ui/SidebarNav';
import AdminTickets from '../components/admin/AdminTickets';
import AdminArchive from '../components/admin/AdminArchive';
import AdminFeedback from '../components/admin/AdminFeedback';
import AdminLabels from '../components/admin/AdminLabels';
import AdminCannedResponses from '../components/admin/AdminCannedResponses';
import AdminBusinessHours from '../components/admin/AdminBusinessHours';
import AdminDepartments from '../components/admin/AdminDepartments';
import AdminAi from '../components/admin/AdminAi';
import AdminTeam from '../components/admin/AdminTeam';
import AdminAuditLog from '../components/admin/AdminAuditLog';
import PartnerUnavailable from '../components/PartnerUnavailable';
import {
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
  Sparkles,
} from 'lucide-react';

const DashboardView = lazy(() => import('../components/admin/dashboard/DashboardView'));
const AdminSatisfaction = lazy(() => import('../components/admin/AdminSatisfaction'));

const LoadingFallback = () => (
  <div className="p-8 text-[13px] text-[var(--color-ink-muted)]">Loading…</div>
);

type AdminTab =
  | 'dashboard'
  | 'satisfaction'
  | 'team'
  | 'business_hours'
  | 'departments'
  | 'tickets'
  | 'archive'
  | 'audit_log'
  | 'feedback'
  | 'labels'
  | 'canned_responses'
  | 'ai_customization';

export default function AdminView() {
  const { user, memberships, activeMembershipId } = useStoreShallow(s => ({
    user: s.user,
    memberships: s.memberships,
    activeMembershipId: s.activeMembershipId,
  }));
  const t = useT();
  const [view, setView] = useState<AdminTab>('dashboard');
  const { width: sidebarWidth, onDragStart: handleDragStart } = useResizableSidebar({
    storageKey: 'guichet.adminSidebarWidth',
    defaultWidth: 240,
    min: 200,
    max: 400,
  });

  if (!user) return null;

  // Guard: partner was deleted or membership is stale
  const activeMembership = (memberships || []).find(m => m.id === activeMembershipId);
  if (activeMembershipId && !activeMembership && !user.isPlatformOperator) return <PartnerUnavailable />;

  const navItem = (id: AdminTab, label: string, icon: React.ReactNode) => (
    <NavButton
      key={id}
      active={view === id}
      onClick={() => setView(id)}
      label={label}
      icon={icon}
    />
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
            <NavGroupLabel>Overview</NavGroupLabel>
            <div className="flex flex-col gap-0.5">
              {navItem('dashboard', t('dashboard'), <LayoutDashboard className="h-4 w-4" />)}
              {navItem('satisfaction', 'Satisfaction', <Star className="h-4 w-4" />)}
            </div>

            <NavGroupLabel>Operations</NavGroupLabel>
            <div className="flex flex-col gap-0.5">
              {navItem('tickets', t('active_tickets'), <MessageSquare className="h-4 w-4" />)}
              {navItem('archive', t('archive'), <Archive className="h-4 w-4" />)}
              {navItem('audit_log', 'Audit Log', <FileText className="h-4 w-4" />)}
              {navItem('feedback', t('feedback_and_ratings'), <Smile className="h-4 w-4" />)}
            </div>

            <NavGroupLabel>Team</NavGroupLabel>
            <div className="flex flex-col gap-0.5">
              {navItem('team', 'Team', <Users className="h-4 w-4" />)}
              {navItem('departments', 'Departments', <Building2 className="h-4 w-4" />)}
            </div>

            <NavGroupLabel>Configuration</NavGroupLabel>
            <div className="flex flex-col gap-0.5">
              {navItem('business_hours', 'Business Hours', <Clock className="h-4 w-4" />)}
              {navItem('labels', t('labels'), <Tag className="h-4 w-4" />)}
              {navItem('canned_responses', t('canned_responses'), <Zap className="h-4 w-4" />)}
              {navItem('ai_customization', t('admin_tab_ai'), <Sparkles className="h-4 w-4" />)}
              {/* DISABLED_FEATURE: Knowledge Base — NavButton hidden until production-ready */}
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
          {view === 'dashboard' && <Suspense fallback={<LoadingFallback />}><DashboardView /></Suspense>}
          {view === 'satisfaction' && <Suspense fallback={<LoadingFallback />}><AdminSatisfaction /></Suspense>}
          {view === 'team' && <AdminTeam />}
          {view === 'business_hours' && <AdminBusinessHours />}
          {view === 'departments' && <AdminDepartments />}
          {view === 'tickets' && <AdminTickets />}
          {view === 'archive' && <AdminArchive />}
          {view === 'audit_log' && <AdminAuditLog />}
          {view === 'feedback' && <AdminFeedback />}
          {view === 'labels' && <AdminLabels />}
          {view === 'canned_responses' && <AdminCannedResponses />}
          {view === 'ai_customization' && <AdminAi />}
          {/* DISABLED_FEATURE: Knowledge Base — tab panel hidden until production-ready */}
        </main>
      </div>
    </ErrorBoundary>
  );
}

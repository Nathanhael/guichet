import React, { lazy, Suspense, useState } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import { useStoreShallow } from '../store/useStore';
import { useT } from '../i18n';
import { APP_NAME } from '../constants';
import PartnerSwitcher from '../components/PartnerSwitcher';
import SettingsPopover from '../components/SettingsPopover';
import UserMenu from '../components/UserMenu';
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
import PartnerUnavailable from '../components/PartnerUnavailable';
import { usePartner } from '../hooks/usePartner';
import { Flame, Building2, Users } from 'lucide-react';

const AdminStats = lazy(() => import('../components/admin/AdminStats'));
const AdminSatisfaction = lazy(() => import('../components/admin/AdminSatisfaction'));

const LoadingFallback = () => (
  <div className="p-8 mono-label text-[10px]">Loading</div>
);

type AdminTab = 'dashboard' | 'satisfaction' | 'alerts' | 'team' | 'business_hours' | 'departments' | 'tickets' | 'archive' | 'feedback' | 'labels' | 'canned_responses'; // DISABLED_FEATURE: removed 'knowledge_base' | 'webhooks'

export default function AdminView() {
  const { user, memberships, activeMembershipId } = useStoreShallow(s => ({
    user: s.user,
    memberships: s.memberships,
    activeMembershipId: s.activeMembershipId,
  }));
  const { partnerName } = usePartner();
  const t = useT();
  const [view, setView] = useState<AdminTab>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  if (!user) return null;

  // Guard: partner was deleted or membership is stale
  const activeMembership = (memberships || []).find(m => m.id === activeMembershipId);
  if (activeMembershipId && !activeMembership && !user.isPlatformOperator) return <PartnerUnavailable />;

  const NavButton = ({ id, label, icon }: { id: AdminTab; label: string; icon: React.ReactNode }) => (
    <button
      onClick={() => setView(id)}
      title={label}
      className={`flex items-center gap-2.5 w-full px-4 py-2.5 font-mono text-[10px] uppercase tracking-wide ${
        sidebarOpen ? 'justify-start' : 'justify-center'
      } ${
        view === id
          ? 'text-[var(--color-accent-blue)] border-l-2 border-[var(--color-accent-blue)]'
          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-accent-blue)] hover:text-white'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      {sidebarOpen && <span className="truncate">{label}</span>}
    </button>
  );

  return (
    <ErrorBoundary>
    <div className="h-screen flex flex-col overflow-hidden bg-[var(--color-bg-base)] text-[var(--color-text-primary)]">
      <nav className="bg-[var(--color-bg-surface)] px-4 md:px-8 py-3 md:py-4 flex items-center justify-between gap-4 md:gap-8 sticky top-0 z-50 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="p-1.5 hover:bg-[var(--color-accent-blue)] hover:text-white"
            aria-label={t('toggle_sidebar')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <img src="/icon-blue.svg" className="w-5 h-5 mr-1" alt="" />
            <span className="text-[13px] font-mono font-bold uppercase tracking-[3px] text-[var(--color-text-primary)]">{APP_NAME}</span>
          </div>
          <span className="text-[10px] bg-[var(--color-text-primary)] text-[var(--color-bg-base)] px-2.5 py-1 font-bold uppercase tracking-wide font-mono ml-2">
            {t('admin')}
          </span>
          <div className="h-6 w-px bg-[var(--color-border)] mx-2" />
          <span className="text-sm font-bold uppercase tracking-wide font-mono">{partnerName}</span>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <PartnerSwitcher />
          <SettingsPopover showAccessibility />
          <UserMenu />
        </div>
      </nav>

      <div className="flex flex-row flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className={`${sidebarOpen ? 'w-52 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:bg-[var(--color-bg-surface)] max-md:top-[57px]' : 'w-14 max-md:w-0 max-md:hidden'} h-full bg-[var(--color-bg-surface)] border-r border-[var(--color-border)] overflow-hidden flex-shrink-0`}>
          {sidebarOpen && <div className="font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] px-4 pt-6 pb-2 select-none">Overview</div>}
          {!sidebarOpen && <div className="pt-4" />}
          <NavButton
            id="dashboard"
            label={t('dashboard')}
            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
          />
          <NavButton
            id="satisfaction"
            label="Satisfaction"
            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.175 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.382-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>}
          />
          <NavButton id="alerts" label="Alerts" icon={<Flame className="h-4 w-4" />} />

          {sidebarOpen ? <div className="font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] px-4 pt-6 pb-2 select-none">Operations</div> : <div className="pt-4 border-t border-[var(--color-border)] mt-2" />}
          <NavButton id="tickets" label={t('active_tickets')} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" /></svg>} />
          <NavButton id="archive" label={t('archive')} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>} />
          <NavButton id="feedback" label={t('feedback_and_ratings')} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.175 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.382-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>} />

          {sidebarOpen ? <div className="font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] px-4 pt-6 pb-2 select-none">Team</div> : <div className="pt-4 border-t border-[var(--color-border)] mt-2" />}
          <NavButton id="team" label="Team" icon={<Users className="h-4 w-4" />} />
          <NavButton id="departments" label="Departments" icon={<Building2 className="h-4 w-4" />} />

          {sidebarOpen ? <div className="font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] px-4 pt-6 pb-2 select-none">Configuration</div> : <div className="pt-4 border-t border-[var(--color-border)] mt-2" />}
          <NavButton id="business_hours" label="Business Hours" icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
          <NavButton id="labels" label={t('labels')} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>} />
          <NavButton id="canned_responses" label={t('canned_responses') || 'Quick Replies'} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>} />
          {/* DISABLED_FEATURE: Knowledge Base, Webhooks — NavButtons hidden until production-ready */}
        </aside>

        {/* Content */}
        <main className={`flex-1 bg-[var(--color-bg-base)] custom-scrollbar ${
          ['tickets', 'archive'].includes(view) ? 'p-0 overflow-hidden' : 'p-4 overflow-y-auto'
        }`}>
          {view === 'dashboard' && <Suspense fallback={<LoadingFallback />}><AdminStats /></Suspense>}
          {view === 'satisfaction' && <Suspense fallback={<LoadingFallback />}><AdminSatisfaction /></Suspense>}
          {view === 'team' && <AdminTeam />}
          {view === 'alerts' && <AdminAlerts />}
          {view === 'business_hours' && <AdminBusinessHours />}
          {view === 'departments' && <AdminDepartments />}
          {view === 'tickets' && <AdminTickets />}
          {view === 'archive' && <AdminArchive />}
          {view === 'feedback' && <AdminFeedback />}
          {view === 'labels' && <AdminLabels />}
          {view === 'canned_responses' && <AdminCannedResponses />}
          {/* DISABLED_FEATURE: Knowledge Base, Webhooks — tab panels hidden until production-ready */}
        </main>
      </div>
    </div>
    </ErrorBoundary>
  );
}

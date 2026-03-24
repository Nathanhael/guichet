import React, { useState } from 'react';
import useStore from '../store/useStore';
import { useT } from '../i18n';
import DarkModeToggle from '../components/DarkModeToggle';
import NeuroToggle from '../components/NeuroToggle';
import LanguageSwitcher from '../components/LanguageSwitcher';
import PartnerSwitcher from '../components/PartnerSwitcher';
import AdminStats from '../components/admin/AdminStats';
import AdminTickets from '../components/admin/AdminTickets';
import AdminArchive from '../components/admin/AdminArchive';
import AdminFeedback from '../components/admin/AdminFeedback';
import AdminLabels from '../components/admin/AdminLabels';
import AdminBusinessHours from '../components/admin/AdminBusinessHours';
import AdminDepartments from '../components/admin/AdminDepartments';
import AdminAlerts from '../components/admin/AdminAlerts';
import AdminTeam from '../components/admin/AdminTeam';
import PartnerUnavailable from '../components/PartnerUnavailable';
import { usePartner } from '../hooks/usePartner';
import { Flame, Building2, Users } from 'lucide-react';

type AdminTab = 'dashboard' | 'alerts' | 'team' | 'business_hours' | 'departments' | 'tickets' | 'archive' | 'feedback' | 'labels';

export default function AdminView() {
  const { user, logout, memberships, activeMembershipId } = useStore();
  const { partnerName, manifest } = usePartner();
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
      title={!sidebarOpen ? label : undefined}
      className={`flex items-center gap-2.5 w-full px-4 py-2.5 text-[10px] font-black uppercase tracking-widest ${
        sidebarOpen ? 'justify-start' : 'justify-center'
      } ${
        view === id
          ? 'bg-black dark:bg-white text-white dark:text-black'
          : 'hover:bg-black/5 dark:hover:bg-white/5'
      }`}
    >
      {icon}
      {sidebarOpen && <span>{label}</span>}
    </button>
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white dark:bg-black text-black dark:text-white">
      <nav className="bg-white dark:bg-black text-black dark:text-white px-4 md:px-8 py-3 md:py-4 flex items-center justify-between gap-4 md:gap-8 sticky top-0 z-50 border-b-2 border-black dark:border-white">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="p-1.5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
              aria-label={t('toggle_sidebar')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span className="font-black text-2xl tracking-tighter uppercase">Tessera</span>
            <span className="text-[10px] bg-black dark:bg-white text-white dark:text-black px-2.5 py-1 font-black uppercase tracking-widest">Admin</span>
            {manifest.logoUrl ? (
              <img src={manifest.logoUrl} alt={partnerName} className="h-6 object-contain" />
            ) : (
              <span className="w-6 h-6 flex items-center justify-center bg-black/10 dark:bg-white/10 text-[10px] font-black uppercase">{partnerName.charAt(0)}</span>
            )}
            <span className="text-[10px] font-black uppercase tracking-widest opacity-40">{partnerName}</span>
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div className="flex flex-col items-end mr-2">
            <span className="text-[10px] font-black uppercase tracking-tight">{user.name}</span>
            <span className="text-[8px] opacity-60 font-black uppercase tracking-widest">{user.role}</span>
          </div>

          <PartnerSwitcher />

          <div className="flex items-center gap-2 bg-black/5 dark:bg-white/5 p-1 border border-black dark:border-white">
            <LanguageSwitcher />
            <NeuroToggle />
            <DarkModeToggle />
            <button onClick={logout} className="p-2 text-black dark:text-white hover:invert" title={t('logout')}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            </button>
          </div>
        </div>
      </nav>

      <div className="flex flex-row flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className={`${sidebarOpen ? 'w-52 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-2xl max-md:bg-white max-md:dark:bg-black max-md:top-[57px]' : 'w-14 max-md:w-0 max-md:hidden'} h-full border-r-2 border-black dark:border-white overflow-hidden flex-shrink-0 transition-all duration-200`}>
          {sidebarOpen && <div className="text-[9px] font-black uppercase tracking-widest opacity-40 px-4 pt-6 pb-2 select-none">Overview</div>}
          {!sidebarOpen && <div className="pt-4" />}
          <NavButton
            id="dashboard"
            label={t('dashboard')}
            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
          />
          <NavButton id="alerts" label="Alerts" icon={<Flame className="h-4 w-4" />} />

          {sidebarOpen ? <div className="text-[9px] font-black uppercase tracking-widest opacity-40 px-4 pt-6 pb-2 select-none">Operations</div> : <div className="pt-4 border-t border-black/10 dark:border-white/10 mt-2" />}
          <NavButton id="tickets" label={t('active_tickets')} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" /></svg>} />
          <NavButton id="archive" label={t('archive')} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>} />
          <NavButton id="feedback" label={t('feedback')} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.175 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.382-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>} />

          {sidebarOpen ? <div className="text-[9px] font-black uppercase tracking-widest opacity-40 px-4 pt-6 pb-2 select-none">Team</div> : <div className="pt-4 border-t border-black/10 dark:border-white/10 mt-2" />}
          <NavButton id="team" label="Team" icon={<Users className="h-4 w-4" />} />
          <NavButton id="departments" label="Departments" icon={<Building2 className="h-4 w-4" />} />

          {sidebarOpen ? <div className="text-[9px] font-black uppercase tracking-widest opacity-40 px-4 pt-6 pb-2 select-none">Configuration</div> : <div className="pt-4 border-t border-black/10 dark:border-white/10 mt-2" />}
          <NavButton id="business_hours" label="Business Hours" icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
          <NavButton id="labels" label={t('labels')} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>} />
        </aside>

        {/* Content */}
        <main className="flex-1 overflow-y-auto bg-white dark:bg-black p-8 custom-scrollbar">
          {view === 'dashboard' && <AdminStats />}
          {view === 'team' && <AdminTeam />}
          {view === 'alerts' && <AdminAlerts />}
          {view === 'business_hours' && <AdminBusinessHours />}
          {view === 'departments' && <AdminDepartments />}
          {view === 'tickets' && <AdminTickets />}
          {view === 'archive' && <AdminArchive />}
          {view === 'feedback' && <AdminFeedback />}
          {view === 'labels' && <AdminLabels />}
        </main>
      </div>
    </div>
  );
}

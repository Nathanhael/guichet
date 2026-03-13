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
import AdminCannedResponses from '../components/admin/AdminCannedResponses';
import AdminAIStats from '../components/admin/AdminAIStats';

type AdminTab = 'dashboard' | 'ai_dashboard' | 'tickets' | 'archive' | 'feedback' | 'labels' | 'canned';

export default function AdminView() {
  const { user, logout } = useStore();
  const t = useT();
  const [view, setView] = useState<AdminTab>('dashboard');

  if (!user) return null;

  const NavButton = ({ id, label, icon }: { id: AdminTab; label: string; icon: React.ReactNode }) => (
    <button
      onClick={() => setView(id)}
      className={`flex items-center gap-2.5 px-4 py-2 rounded-xl text-sm font-bold transition-all duration-300 ${
        view === id
          ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/20 translate-y-[-1px]'
          : 'text-solarized-base1 dark:text-gray-400 hover:text-solarized-base01 dark:hover:text-white hover:bg-solarized-base2 dark:hover:bg-brand-800'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-transparent animate-fade-in">
      <nav className="bg-brand-900/95 backdrop-blur-md text-white px-6 py-3 flex items-center justify-between shadow-lg sticky top-0 z-50 border-b border-brand-800">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3">
            <span className="font-bold text-xl tracking-tight">M&P Support</span>
            <span className="text-xs bg-gradient-to-r from-accent-500 to-rose-500 px-2.5 py-1 rounded-md font-semibold tracking-wide shadow-sm">Admin</span>
          </div>

          <div className="hidden lg:flex items-center gap-1">
            <NavButton
              id="dashboard"
              label={t('dashboard')}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              }
            />
            <NavButton
              id="ai_dashboard"
              label="AI Insights"
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              }
            />
            <NavButton
              id="tickets"
              label={t('active_tickets')}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                </svg>
              }
            />
            <NavButton
              id="archive"
              label={t('archive')}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
              }
            />
            <NavButton
              id="feedback"
              label={t('feedback')}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.175 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.382-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              }
            />
            <NavButton
              id="labels"
              label={t('labels')}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
              }
            />
            <NavButton
              id="canned"
              label="Shortcuts"
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              }
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex flex-col items-end mr-2">
            <span className="text-sm font-bold text-white">{user.name}</span>
            <span className="text-[10px] text-brand-300 font-medium uppercase tracking-wider">{user.role}</span>
          </div>

          <PartnerSwitcher />

          <div className="flex items-center gap-2 bg-black/10 dark:bg-white/5 p-1 rounded-xl border border-white/10">
            <LanguageSwitcher />
            <NeuroToggle />
            <DarkModeToggle />
            <button
              onClick={logout}
              className="p-2 text-solarized-base1 hover:text-rose-400 hover:bg-rose-400/10 rounded-lg transition-all"
              title={t('logout')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto bg-slate-50/50 dark:bg-brand-950 p-6 custom-scrollbar">
        {view === 'dashboard' && <AdminStats />}
        {view === 'ai_dashboard' && <AdminAIStats />}
        {view === 'tickets' && <AdminTickets />}
        {view === 'archive' && <AdminArchive />}
        {view === 'feedback' && <AdminFeedback />}
        {view === 'labels' && <AdminLabels />}
        {view === 'canned' && <AdminCannedResponses />}
      </main>
    </div>
  );
}

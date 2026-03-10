import React, { useEffect, useState } from 'react';
import useStore from '../store/useStore';
import { useT } from '../i18n';
import { STATS_REFRESH_MS } from '../config';
import DarkModeToggle from '../components/DarkModeToggle';
import ErrorBoundary from '../components/ErrorBoundary';
import NeuroToggle from '../components/NeuroToggle';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { requestNotificationPermission } from '../utils/notifications';

// Modular Components
import StatsOverview from '../components/admin/Stats/StatsOverview';
import QueueHealth from '../components/admin/Stats/QueueHealth';
import DeptDistribution from '../components/admin/Stats/DeptDistribution';
import PerformanceTrends from '../components/admin/Stats/PerformanceTrends';
import SatisfactionByDept from '../components/admin/Stats/SatisfactionByDept';

import LLMSummary from '../components/admin/Stats/LLMSummary';
import OnlineExperts from '../components/admin/Stats/OnlineExperts';

import ExpertPerformance from '../components/admin/Performance/ExpertPerformance';
import ExpertRatings from '../components/admin/Performance/ExpertRatings';
import AgentPerformance from '../components/admin/Performance/AgentPerformance';
import AgentActivityTrend from '../components/admin/Performance/AgentActivityTrend';
import PeakHours from '../components/admin/Performance/PeakHours';
import StaffingDemand from '../components/admin/Stats/StaffingDemand';
import HourSpotlight from '../components/admin/Stats/HourSpotlight';

import TicketOperations from '../components/admin/TicketOperations';
import ArchiveView from '../components/admin/Archive/ArchiveView';
import FeedbackList from '../components/admin/Feedback/FeedbackList';
import RatingStats from '../components/admin/Feedback/RatingStats';
import LabelManager from '../components/admin/Labels/LabelManager';

export default function AdminView() {
  const { user, token, setTickets, logout, onlineExperts, notificationsEnabled, setNotificationsEnabled } = useStore();
  const t = useT();
  const [stats, setStats] = useState(null);
  const [view, setView] = useState('stats');
  const [statsDept, setStatsDept] = useState('all');
  const [statsDateFrom, setStatsDateFrom] = useState('');
  const [statsDateTo, setStatsDateTo] = useState('');
  const [excludeWeekends, setExcludeWeekends] = useState(false);
  const [activePreset, setActivePreset] = useState(null);
  const [selectedHour, setSelectedHour] = useState(null);

  // Feedback local state (to be passed down)
  const [feedback, setFeedback] = useState([]);
  const [loadingFeedback, setLoadingFeedback] = useState(false);
  const [ratings, setRatings] = useState([]);
  const [users, setUsers] = useState([]);

  function applyPreset(key) {
    const now = new Date();
    const toStr = now.toISOString().slice(0, 10);
    let fromStr;
    if (key === 'today') {
      fromStr = toStr;
    } else if (key === '7d') {
      const d = new Date(now); d.setDate(d.getDate() - 6);
      fromStr = d.toISOString().slice(0, 10);
    } else if (key === '14d') {
      const d = new Date(now); d.setDate(d.getDate() - 13);
      fromStr = d.toISOString().slice(0, 10);
    } else if (key === '30d') {
      const d = new Date(now); d.setDate(d.getDate() - 29);
      fromStr = d.toISOString().slice(0, 10);
    }
    setStatsDateFrom(fromStr);
    setStatsDateTo(toStr);
    setActivePreset(key);
  }

  const fetchStats = () => {
    const params = new URLSearchParams();
    if (statsDept !== 'all') params.set('dept', statsDept);
    if (statsDateFrom) params.set('dateFrom', statsDateFrom);
    if (statsDateTo) params.set('dateTo', statsDateTo);
    if (excludeWeekends) params.set('excludeWeekends', 'true');
    fetch(`/api/stats?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then((r) => r.json()).then(setStats).catch(console.error);
  };

  const fetchFeedback = () => {
    setLoadingFeedback(true);
    fetch('/api/feedback', {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(r => r.json()).then(setFeedback).finally(() => setLoadingFeedback(false));
  };

  const markTreated = async (id) => {
    const res = await fetch(`/api/feedback/${id}/treat`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) setFeedback(feedback.map(f => f.id === id ? { ...f, treated: true } : f));
  };

  useEffect(() => {
    fetch('/api/tickets', {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then((r) => r.json()).then(setTickets).catch(console.error);
    fetchStats();
  }, [statsDept, statsDateFrom, statsDateTo, excludeWeekends]);

  useEffect(() => {
    if (notificationsEnabled) {
      requestNotificationPermission();
    }
  }, [notificationsEnabled]);

  useEffect(() => {
    const interval = setInterval(fetchStats, STATS_REFRESH_MS);
    return () => clearInterval(interval);
  }, [statsDept, statsDateFrom, statsDateTo, excludeWeekends]);

  useEffect(() => {
    if (view === 'feedback') {
      fetchFeedback();
      fetch('/api/ratings', {
        headers: { 'Authorization': `Bearer ${token}` }
      }).then(r => r.json()).then(setRatings);
      fetch('/api/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      }).then(r => r.json()).then(setUsers);
    }
  }, [view]);

  const navItems = [
    { key: 'stats', label: t('statistics'), icon: '📊' },
    { key: 'tickets', label: t('open_tickets'), icon: '📋' },
    { key: 'archive', label: t('archive'), icon: '🗂' },
    { key: 'feedback', label: t('feedback'), icon: '💬' },
    { key: 'labels', label: 'Labels', icon: '🏷️' },
  ];

  return (
    <div className="min-h-screen bg-transparent animate-fade-in flex flex-col">
      <nav className="bg-brand-900/95 backdrop-blur-md text-white px-6 py-3 flex items-center justify-between shadow-lg sticky top-0 z-50 border-b border-brand-800">
        <div className="flex items-center gap-3">
          <span className="font-bold text-xl tracking-tight">M&P Support</span>
          <span className="text-xs bg-brand-800 border border-brand-700 px-2.5 py-1 rounded-md font-semibold tracking-wide">Admin</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-brand-100">{user.name}</span>
          
          <div className="flex items-center gap-2 bg-black/10 dark:bg-white/5 p-1 rounded-xl border border-white/10 ml-2">
            <LanguageSwitcher />
            <NeuroToggle />
            <DarkModeToggle />
            <button
              onClick={() => setNotificationsEnabled(!notificationsEnabled)}
              title={notificationsEnabled ? 'Disable notifications' : 'Enable notifications'}
              className={`p-2 rounded-lg flex items-center justify-center transition-all duration-300 ${
                notificationsEnabled 
                  ? 'text-accent-400 bg-white/10 shadow-sm' 
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              {notificationsEnabled ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              )}
            </button>
          </div>

          <button onClick={logout} className="text-brand-200 hover:text-rose-400 text-sm font-medium ml-2 transition-colors">{t('sign_out')}</button>
        </div>
      </nav>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-56 glass-panel border-r border-white/20 dark:border-brand-700/50 p-4 space-y-2 relative z-10">
          {navItems.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => { setView(key); }}
              className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300 flex items-center gap-3 ${view === key
                ? 'bg-gradient-to-r from-accent-500 to-rose-500 text-white shadow-md shadow-accent-500/20 translate-x-1'
                : 'text-slate-600 dark:text-gray-400 hover:bg-white/60 dark:hover:bg-brand-700/50 hover:shadow-sm'
                }`}
            >
              <span className="text-lg w-6 flex justify-center">{icon}</span> <span>{label}</span>
            </button>
          ))}
        </aside>

        <main className="flex-1 p-6 lg:p-8 overflow-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-slate-300/50">
          {view === 'stats' && (
            <div className="space-y-6 max-w-7xl mx-auto animate-slide-up pb-10">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-800 dark:text-white tracking-tight">{t('dashboard')}</h2>
                  <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">Real-time performance metrics and historical trends</p>
                </div>

                {/* Filter Bar */}
                <div className="flex flex-wrap items-center gap-2 bg-white/50 dark:bg-brand-800/50 p-2 rounded-2xl border border-white/20 dark:border-brand-700/50 backdrop-blur-sm self-start">
                  <div className="flex gap-1">
                    {['all', 'DSC', 'FOT'].map((d) => (
                      <button key={d} onClick={() => setStatsDept(d)}
                        className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all duration-300 ${statsDept === d ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'text-slate-500 dark:text-gray-400 hover:bg-white/80 dark:hover:bg-brand-700'}`}>
                        {d === 'all' ? 'All' : d}
                      </button>
                    ))}
                  </div>
                  <div className="w-px h-6 bg-slate-200 dark:bg-brand-700 mx-1 invisible md:visible" />
                  <div className="flex gap-1">
                    {[{ key: 'today', label: 'Today' }, { key: '7d', label: '7D' }, { key: '14d', label: '14D' }, { key: '30d', label: '30D' }].map(({ key, label }) => (
                      <button key={key} onClick={() => applyPreset(key)}
                        className={`px-2.5 py-1.5 text-xs font-bold rounded-xl transition-all duration-300 ${activePreset === key ? 'bg-accent-500 text-white shadow-md shadow-accent-500/20' : 'text-slate-500 dark:text-gray-400 hover:bg-white/80 dark:hover:bg-brand-700'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="w-px h-6 bg-slate-200 dark:bg-brand-700 mx-1 invisible md:visible" />
                  <div className="flex items-center gap-2">
                    <input type="date" value={statsDateFrom} onChange={(e) => { setStatsDateFrom(e.target.value); setActivePreset(null); }}
                      className="border-none bg-white/60 dark:bg-gray-700/80 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-gray-200 focus:ring-2 focus:ring-brand-500 outline-none" />
                    <span className="text-slate-400 text-xs">→</span>
                    <input type="date" value={statsDateTo} onChange={(e) => { setStatsDateTo(e.target.value); setActivePreset(null); }}
                      className="border-none bg-white/60 dark:bg-gray-700/80 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-gray-200 focus:ring-2 focus:ring-brand-500 outline-none" />

                    <div className="w-px h-6 bg-slate-200 dark:bg-brand-700 mx-1 invisible md:visible" />

                    <button
                      onClick={() => setExcludeWeekends(!excludeWeekends)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl transition-all duration-300 ${excludeWeekends ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20' : 'text-slate-500 dark:text-gray-400 hover:bg-white/80 dark:hover:bg-brand-700'}`}
                      title="Hide Saturdays and Sundays from data"
                    >
                      <span className="text-sm">🗓️</span>
                      No Weekends
                    </button>

                    {(statsDept !== 'all' || statsDateFrom || statsDateTo || excludeWeekends) && (
                      <button
                        onClick={() => { setStatsDept('all'); setStatsDateFrom(''); setStatsDateTo(''); setExcludeWeekends(false); setActivePreset(null); }}
                        className="p-1.5 text-slate-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/40 rounded-lg transition-colors"
                        title="Clear all filters"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {!stats ? <p className="text-slate-400">{t('loading')}</p> : (<>
                <ErrorBoundary><StatsOverview stats={stats} /></ErrorBoundary>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <ErrorBoundary><QueueHealth stats={stats} /></ErrorBoundary>
                  <ErrorBoundary><DeptDistribution stats={stats} /></ErrorBoundary>
                  <ErrorBoundary><OnlineExperts onlineExperts={onlineExperts} /></ErrorBoundary>
                </div>

                <ErrorBoundary><PerformanceTrends stats={stats} /></ErrorBoundary>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2">
                    <ErrorBoundary>
                      <StaffingDemand
                        hourlyStaffing={stats.hourlyStaffing}
                        activeHour={selectedHour}
                        onHourClick={setSelectedHour}
                        className="h-full"
                      />
                    </ErrorBoundary>
                  </div>
                  <div className="lg:col-span-1 flex flex-col gap-6 h-full">
                    <ErrorBoundary>
                      <PeakHours
                        hourlyDistribution={stats.hourlyDistribution}
                        activeHour={selectedHour}
                        onHourClick={setSelectedHour}
                        className="flex-1"
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <HourSpotlight
                        hourData={selectedHour !== null ? stats.hourlyStaffing.find(h => h.hour === selectedHour) : null}
                        expertStats={stats.expertStats}
                        className="flex-1"
                      />
                    </ErrorBoundary>
                  </div>
                </div>

                <ErrorBoundary><SatisfactionByDept stats={stats} /></ErrorBoundary>

                <ErrorBoundary>
                  <ExpertRatings expertStats={stats.expertStats} className="mt-6" />
                </ErrorBoundary>

                <div className="grid grid-cols-1 gap-6 mt-6">
                  <ErrorBoundary><ExpertPerformance expertStats={stats.expertStats} /></ErrorBoundary>
                  <ErrorBoundary><AgentPerformance agentStats={stats.agentStats} /></ErrorBoundary>
                  <ErrorBoundary><AgentActivityTrend agentStats={stats.agentStats} /></ErrorBoundary>
                </div>

                <div className="pt-4">
                  {(() => {
                    let aiType = 'day';
                    let aiValue = new Date().toISOString().slice(0, 10);
                    if (activePreset === '7d' || activePreset === '14d' || activePreset === '30d') {
                      aiType = 'month';
                      aiValue = new Date().toISOString().slice(0, 7);
                    } else if (statsDateFrom) {
                      aiValue = statsDateFrom;
                    }
                    return <ErrorBoundary><LLMSummary periodType={aiType} periodValue={aiValue} /></ErrorBoundary>;
                  })()}
                </div>
              </>)}
            </div>
          )}

          {view === 'tickets' && <TicketOperations t={t} />}
          {view === 'archive' && <ArchiveView />}
          {view === 'feedback' && (
            <div className="space-y-12 max-w-5xl mx-auto py-4">
              <section className="animate-fade-in">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-brand-100 dark:bg-brand-900/50 rounded-lg text-brand-600 dark:text-brand-400">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-white tracking-tight">Agent Feedback</h2>
                    <p className="text-sm text-gray-400">Direct notes and concerns from your agent team.</p>
                  </div>
                </div>
                <FeedbackList feedback={feedback} loading={loadingFeedback} markTreated={markTreated} />
              </section>

              <section className="animate-fade-in border-t border-gray-100 dark:border-brand-700 pt-12">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-amber-100 dark:bg-amber-900/40 rounded-lg text-amber-600 dark:text-amber-400">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.382-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-white tracking-tight">Performance Ratings</h2>
                    <p className="text-sm text-gray-400">Customer satisfaction scores and expert-level analysis.</p>
                  </div>
                </div>
                <RatingStats ratings={ratings} users={users} />
              </section>
            </div>
          )}
          {view === 'labels' && <LabelManager />}
        </main >
      </div >
    </div >
  );
}

import React, { useEffect, useState, useRef } from 'react';
import useStore from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { useT } from '../i18n';
import ChatWindow from '../components/ChatWindow';
import TicketPreview from '../components/TicketPreview';
import TicketList from '../components/TicketList';
import DarkModeToggle from '../components/DarkModeToggle';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

const DEPT_COLOR = { DSC: 'bg-purple-100 text-purple-700', FOT: 'bg-teal-100 text-teal-700' };

function TabIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
    </svg>
  );
}

function SplitIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
    </svg>
  );
}

function VSplitIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v14a1 1 0 01-1 1h-4a1 1 0 01-1-1V5z" />
    </svg>
  );
}

function splitGridClass(count) {
  if (count === 1) return 'grid-cols-1 grid-rows-1';
  if (count === 2) return 'grid-cols-2 grid-rows-1';
  return 'grid-cols-2 grid-rows-2';
}

function vsplitGridClass(count) {
  if (count === 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-2';
  if (count === 3) return 'grid-cols-3';
  return 'grid-cols-4';
}

export default function ManagerView() {
  const { user, tickets, setTickets, logout, onlineExperts, expertOpenTickets, addExpertOpenTicket, removeExpertOpenTicket, unreadTickets, clearUnread } = useStore();
  const t = useT();
  const [stats, setStats] = useState(null);
  const [view, setView] = useState('stats');
  const [activeTab, setActiveTab] = useState(null);
  const [viewMode, setViewMode] = useState('tabs');
  const [focusedTicketId, setFocusedTicketId] = useState(null);
  const [statsDept, setStatsDept] = useState('all');
  const [statsDateFrom, setStatsDateFrom] = useState('');
  const [statsDateTo, setStatsDateTo] = useState('');

  const fetchStats = () => {
    const params = new URLSearchParams();
    if (statsDept !== 'all') params.set('dept', statsDept);
    if (statsDateFrom) params.set('dateFrom', statsDateFrom);
    if (statsDateTo) params.set('dateTo', statsDateTo);
    fetch(`/api/stats?${params.toString()}`).then((r) => r.json()).then(setStats).catch(console.error);
  };

  useEffect(() => {
    fetch('/api/tickets').then((r) => r.json()).then(setTickets).catch(console.error);
    fetchStats();
  }, [statsDept, statsDateFrom, statsDateTo]);

  useEffect(() => {
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [statsDept, statsDateFrom, statsDateTo]);

  const openTickets = tickets.filter((t) => t.status !== 'closed');
  const [previewTicketId, setPreviewTicketId] = useState(null);
  const [previewMessages, setPreviewMessages] = useState([]);

  // Fetch messages when previewing an open ticket
  useEffect(() => {
    if (!previewTicketId) return;
    fetch(`/api/messages?ticketId=${previewTicketId}`)
      .then((r) => r.json())
      .then(setPreviewMessages)
      .catch(() => setPreviewMessages([]));
  }, [previewTicketId]);

  const previewTicket = previewTicketId ? openTickets.find((t) => t.id === previewTicketId) : null;
  const openTabTickets = expertOpenTickets.map((id) => tickets.find((t) => t.id === id)).filter(Boolean).slice(0, 4);
  const atMaxChats = openTabTickets.length >= 4;

  function selectOpenTicket(ticket) {
    const isParticipant = ticket.participants?.some(p => p.id === user.id);
    if (expertOpenTickets.includes(ticket.id) || isParticipant) {
      if (!expertOpenTickets.includes(ticket.id)) {
        addExpertOpenTicket(ticket.id);
        getSocket().emit('expert:join', { ticketId: ticket.id, expertId: user.id, expertName: user.name, expertLang: user.lang });
      }
      switchTab(ticket.id);
      setPreviewTicketId(null);
    } else if (!atMaxChats) {
      if (previewTicketId === ticket.id) {
        setPreviewTicketId(null);
      } else {
        setPreviewTicketId(ticket.id);
      }
    }
  }

  function joinAsObserver(ticket) {
    getSocket().emit('expert:join', { ticketId: ticket.id, expertId: user.id, expertName: user.name, expertLang: user.lang });
    addExpertOpenTicket(ticket.id);
    setActiveTab(ticket.id);
    clearUnread(ticket.id);
    setPreviewTicketId(null);
  }

  function switchTab(ticketId) {
    setActiveTab(ticketId);
    clearUnread(ticketId);
  }

  function closeTab(ticketId) {
    getSocket().emit('expert:leave', { ticketId, expertId: user.id, expertName: user.name });
    removeExpertOpenTicket(ticketId);
    clearUnread(ticketId);
    if (focusedTicketId === ticketId) setFocusedTicketId(null);
    if (activeTab === ticketId) {
      const remaining = openTabTickets.filter((t) => t.id !== ticketId);
      setActiveTab(remaining[0]?.id || null);
    }
  }


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
          <span className="font-bold text-xl tracking-tight">iKanbi</span>
          <span className="text-xs bg-brand-800 border border-brand-700 px-2.5 py-1 rounded-md font-semibold tracking-wide">Manager</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-brand-100">{user.name}</span>
          <div className="h-4 w-px bg-brand-700"></div>
          <DarkModeToggle />
          <button onClick={logout} className="text-brand-200 hover:text-white text-sm font-medium transition-colors">{t('sign_out')}</button>
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
                        className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all duration-300 ${statsDept === d ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'text-slate-500 dark:text-gray-400 hover:bg-white dark:hover:bg-brand-700'}`}>
                        {d === 'all' ? 'All' : d}
                      </button>
                    ))}
                  </div>
                  <div className="w-px h-6 bg-slate-200 dark:bg-brand-700 mx-1 invisible md:visible" />
                  <div className="flex items-center gap-2">
                    <input type="date" value={statsDateFrom} onChange={(e) => setStatsDateFrom(e.target.value)}
                      className="border-none bg-white/80 dark:bg-gray-700/80 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-gray-200 focus:ring-2 focus:ring-brand-500 outline-none" />
                    <span className="text-slate-400 text-xs">→</span>
                    <input type="date" value={statsDateTo} onChange={(e) => setStatsDateTo(e.target.value)}
                      className="border-none bg-white/80 dark:bg-gray-700/80 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-gray-200 focus:ring-2 focus:ring-brand-500 outline-none" />
                    {(statsDept !== 'all' || statsDateFrom || statsDateTo) && (
                      <button
                        onClick={() => { setStatsDept('all'); setStatsDateFrom(''); setStatsDateTo(''); }}
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
                {/* KPI row */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  <StatCard label="Total Tickets" value={stats.total} color="dark" />
                  <StatCard label="Response Time" value={stats.avgResponseMinutes > 0 ? `${stats.avgResponseMinutes}m` : '—'} color="gray" />
                  <StatCard label="Avg Duration" value={stats.avgDurationMinutes > 0 ? `${stats.avgDurationMinutes}m` : '—'} color="gray" />
                  <StatCard label="Satisfaction" value={stats.avgRating > 0 ? `${stats.avgRating} ⭐` : '—'} color="yellow" />
                  <StatCard label="Abandoned" value={stats.abandonedCount} color="red" />
                  <StatCard
                    label="SLA Health"
                    value={`${stats.slaHealth}%`}
                    color={stats.slaHealth >= 90 ? 'teal' : stats.slaHealth >= 70 ? 'yellow' : 'red'}
                  />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Panel title="Queue health">
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div className={`rounded-lg p-3 ${stats.oldestWaitMinutes > 3 ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800' : 'bg-gray-50 dark:bg-gray-700'}`}>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Oldest waiting</p>
                        <p className={`text-2xl font-bold mt-0.5 ${stats.oldestWaitMinutes > 3 ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-white'}`}>
                          {stats.oldestWaitMinutes > 0 ? `${stats.oldestWaitMinutes}m` : '—'}
                        </p>
                      </div>
                      <div className={`rounded-lg p-3 ${stats.waitingOver3 > 0 ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800' : 'bg-gray-50 dark:bg-gray-700'}`}>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Waiting &gt;3 min</p>
                        <p className={`text-2xl font-bold mt-0.5 ${stats.waitingOver3 > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-800 dark:text-white'}`}>
                          {stats.waitingOver3}
                        </p>
                      </div>
                    </div>

                    {/* Dept Distribution Bar */}
                    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                      <p className="text-[10px] uppercase font-bold text-gray-400 mb-2 tracking-wider">DSC vs FOT Distribution</p>
                      <div className="h-2 w-full bg-teal-500 rounded-full overflow-hidden flex">
                        <div
                          className="h-full bg-purple-500 transition-all duration-500"
                          style={{ width: `${Math.round((stats.dscCount / (stats.total || 1)) * 100)}%` }}
                        />
                      </div>
                      <div className="flex justify-between mt-1.5">
                        <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400">
                          ● DSC {Math.round((stats.dscCount / (stats.total || 1)) * 100)}%
                        </span>
                        <span className="text-[10px] font-bold text-teal-600 dark:text-teal-400">
                          ● FOT {Math.round((stats.fotCount / (stats.total || 1)) * 100)}%
                        </span>
                      </div>
                    </div>
                    {stats.total > 0 && (
                      <>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">DSC vs FOT Distribution</p>
                        <div className="flex rounded-full overflow-hidden h-3">
                          <div className="bg-purple-400" style={{ width: `${(stats.dscCount / stats.total) * 100}%` }} />
                          <div className="bg-teal-400" style={{ width: `${(stats.fotCount / stats.total) * 100}%` }} />
                        </div>
                        <div className="flex gap-4 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400 inline-block" /> DSC {Math.round((stats.dscCount / stats.total) * 100)}%</span>
                          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-teal-400 inline-block" /> FOT {Math.round((stats.fotCount / stats.total) * 100)}%</span>
                        </div>
                      </>
                    )}
                  </Panel>

                  <Panel title={`Online now (${onlineExperts.length})`}>
                    {onlineExperts.length === 0 ? (
                      <p className="text-sm text-gray-400">No experts online</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {onlineExperts.map((e) => (
                          <div key={e.userId} title={`${e.name} · ${e.status || 'available'}`} className="relative group flex items-center gap-2 bg-gray-50 dark:bg-gray-700 border border-gray-100 dark:border-brand-600 rounded-full pl-1.5 pr-4 py-1.5 cursor-default">
                            <div className="w-6 h-6 rounded-full bg-brand-100 dark:bg-brand-900/50 flex items-center justify-center text-xs font-bold text-brand-600 dark:text-brand-400 shrink-0">
                              {e.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-200 leading-none truncate max-w-[120px]">
                              {e.name}
                            </span>
                            <span className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-white dark:ring-gray-800 ${e.status === 'break' ? 'bg-yellow-400' : e.status === 'lunch' ? 'bg-orange-400' : e.status === 'meeting' ? 'bg-gray-400' : 'bg-green-400'}`} />
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>
                </div>

                <Panel title={`Tickets Trend (${stats.dailyTrend.length} days)`}>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={stats.dailyTrend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={Math.ceil(stats.dailyTrend.length / 10)} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip />
                      <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="total" stroke="#e24e1b" strokeWidth={2} dot={false} name="Total" />
                      <Line type="monotone" dataKey="dsc" stroke="#a855f7" strokeWidth={1.5} dot={false} name="DSC" />
                      <Line type="monotone" dataKey="fot" stroke="#14b8a6" strokeWidth={1.5} dot={false} name="FOT" />
                    </LineChart>
                  </ResponsiveContainer>
                </Panel>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Panel title="Expert performance">
                    {stats.expertStats.length === 0 ? (
                      <p className="text-sm text-gray-400">No data yet</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={Math.max(160, stats.expertStats.length * 40)}>
                        <BarChart data={stats.expertStats} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                          <Tooltip />
                          <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                          <Bar dataKey="total" fill="#6366f1" radius={[0, 3, 3, 0]} name="Total Tasks" />
                          <Bar dataKey="today" fill="#a5b4fc" radius={[0, 3, 3, 0]} name="Today" />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </Panel>

                  <Panel title="Peak Hours Distribution">
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={stats.hourlyDistribution} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickFormatter={(h) => `${h}h`} />
                        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                        <Tooltip formatter={(v) => [v, 'Tickets']} labelFormatter={(h) => `${h}:00`} />
                        <Bar dataKey="count" fill="#e24e1b" radius={[3, 3, 0, 0]} name="Tickets" />
                      </BarChart>
                    </ResponsiveContainer>
                  </Panel>
                </div>
              </>)}
            </div>
          )}

          {view === 'tickets' && (
            <div className="flex gap-4 items-start h-[calc(100vh-8rem)]">
              <div className="w-80 bg-white dark:bg-brand-800 rounded-xl shadow-sm border border-gray-100 dark:border-brand-700 overflow-hidden shrink-0 h-full flex flex-col">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-brand-700">
                  <h2 className="font-semibold text-gray-700 dark:text-gray-300 text-sm">{t('open_tickets')} ({openTickets.length})</h2>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <TicketList tickets={openTickets} onSelect={selectOpenTicket} activeId={previewTicketId || activeTab} />
                </div>
              </div>

              {/* Chat area */}
              <div className="flex-1 h-full overflow-hidden flex flex-col">
                {previewTicket ? (
                  <TicketPreview
                    ticket={previewTicket}
                    messages={previewMessages}
                    onJoin={() => joinAsObserver(previewTicket)}
                    onClose={() => setPreviewTicketId(null)}
                    t={t}
                    joinDisabled={atMaxChats}
                  />
                ) : openTabTickets.length === 0 ? (
                  <div className="h-full flex items-center justify-center border border-dashed border-gray-200 dark:border-brand-700 rounded-xl">
                    <p className="text-gray-400">Select a ticket from the queue to observe.</p>
                  </div>
                ) : (
                  <div className="flex-1 h-full flex flex-col border border-gray-200 dark:border-brand-700 rounded-xl overflow-hidden bg-white dark:bg-brand-800">
                    {/* Tab bar + view toggle */}
                    <div className="bg-gray-50 dark:bg-brand-900 border-b border-gray-200 dark:border-brand-700 flex items-center">
                      {viewMode === 'tabs' && (
                        <div className="flex overflow-x-auto flex-1">
                          {openTabTickets.map((ticket) => {
                            const hasUnread = unreadTickets.has(ticket.id) && activeTab !== ticket.id;
                            return (
                              <button
                                key={ticket.id}
                                onClick={() => switchTab(ticket.id)}
                                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${activeTab === ticket.id
                                  ? 'border-brand-500 text-brand-600 dark:text-brand-400 bg-white dark:bg-brand-800'
                                  : hasUnread
                                    ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 animate-pulse'
                                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                                  }`}
                              >
                                {hasUnread && <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0 animate-bounce" />}
                                <span className={`text-xs px-1.5 py-0.5 rounded ${DEPT_COLOR[ticket.dept]}`}>{ticket.dept}</span>
                                <span className="max-w-32 truncate">{ticket.agentName}</span>
                                {ticket.cdbId && <span className="text-xs font-mono text-gray-400">#{ticket.cdbId}</span>}
                                {ticket.dareRef && <span className="text-xs font-mono text-gray-400">{ticket.dareRef}</span>}
                                <span
                                  onClick={(e) => { e.stopPropagation(); closeTab(ticket.id); }}
                                  className="ml-1 text-gray-400 hover:text-gray-600 text-base leading-none"
                                >×</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {(viewMode === 'split' || viewMode === 'vsplit') && (
                        <div className="flex-1 px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
                          {openTabTickets.length} {openTabTickets.length === 1 ? 'chat' : 'chats'} open
                          {openTabTickets.length < 4 && <span className="ml-2 text-gray-400">· max 4</span>}
                        </div>
                      )}

                      {/* View toggle */}
                      <div className="flex items-center gap-1 px-3 border-l border-gray-200 dark:border-brand-700 shrink-0 py-1">
                        <button onClick={() => setViewMode('tabs')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'tabs' ? 'bg-white dark:bg-brand-800 text-brand-600 shadow-sm' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-brand-700'}`}><TabIcon /></button>
                        <button onClick={() => setViewMode('vsplit')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'vsplit' ? 'bg-white dark:bg-brand-800 text-brand-600 shadow-sm' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-brand-700'}`}><VSplitIcon /></button>
                        <button onClick={() => setViewMode('split')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'split' ? 'bg-white dark:bg-brand-800 text-brand-600 shadow-sm' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-brand-700'}`}><SplitIcon /></button>
                      </div>
                    </div>

                    {/* Multiple Chats Area */}
                    <div className="flex-1 overflow-hidden">
                      {viewMode === 'tabs' ? (
                        <div className="h-full p-0">
                          {(() => {
                            const ticket = tickets.find((t) => t.id === activeTab) || openTabTickets[0];
                            return ticket ? <ChatWindow ticket={ticket} onClose={() => closeTab(ticket.id)} /> : null;
                          })()}
                        </div>
                      ) : focusedTicketId && openTabTickets.find((t) => t.id === focusedTicketId) ? (
                        <div className="h-full flex flex-col">
                          {openTabTickets.length > 1 && (
                            <div className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 dark:bg-brand-800 border-b border-gray-200 dark:border-brand-700 shrink-0">
                              {openTabTickets.map((t) => {
                                const isFocused = t.id === focusedTicketId;
                                const hasUnread = unreadTickets.has(t.id) && !isFocused;
                                return (
                                  <button
                                    key={t.id}
                                    onClick={() => isFocused ? null : setFocusedTicketId(t.id)}
                                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${isFocused
                                      ? 'bg-brand-500 text-white'
                                      : hasUnread
                                        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 animate-pulse'
                                        : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                                      }`}
                                  >
                                    <span className={`text-[10px] px-1 py-0.5 rounded ${DEPT_COLOR[t.dept]}`}>{t.dept}</span>
                                    <span className="max-w-20 truncate">{t.agentName}</span>
                                    {hasUnread && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                                  </button>
                                );
                              })}
                              <button
                                onClick={() => setFocusedTicketId(null)}
                                className="ml-auto text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 px-2 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                              >
                                Show all
                              </button>
                            </div>
                          )}
                          <div className="flex-1 min-h-0 p-0">
                            <ChatWindow
                              ticket={openTabTickets.find((t) => t.id === focusedTicketId)}
                              onClose={() => closeTab(focusedTicketId)}
                              onFocus={() => setFocusedTicketId(null)}
                              focused
                            />
                          </div>
                        </div>
                      ) : (
                        <div className={`h-full grid gap-[1px] bg-gray-200 dark:bg-brand-700 ${viewMode === 'vsplit' ? vsplitGridClass(openTabTickets.length) : splitGridClass(openTabTickets.length)}`}>
                          {openTabTickets.map((ticket) => (
                            <div key={ticket.id} className="min-h-0 overflow-hidden bg-white dark:bg-brand-800">
                              <ChatWindow
                                ticket={ticket}
                                onClose={() => closeTab(ticket.id)}
                                onFocus={() => setFocusedTicketId(ticket.id)}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {view === 'archive' && <ManagerArchive />}
          {view === 'feedback' && <ManagerFeedback />}
          {view === 'labels' && <ManagerLabels />}
        </main >
      </div >
    </div >
  );
}

const LIMIT = 25;

function ManagerArchive() {
  const [tickets, setTickets] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [preview, setPreview] = useState(null);     // selected ticket
  const [messages, setMessages] = useState([]);
  const [allLabels, setAllLabels] = useState([]);
  const [labelFilter, setLabelFilter] = useState('all');
  const t = useT();

  function fetchTickets({ reset = false, s = search, d = dept, from = dateFrom, to = dateTo, off = 0 } = {}) {
    setLoading(true);
    const params = new URLSearchParams({ status: 'closed', limit: LIMIT, offset: off });
    if (d !== 'all') params.set('dept', d);
    if (s.trim()) params.set('search', s.trim());
    if (from) params.set('dateFrom', from);
    if (to) params.set('dateTo', to);
    fetch(`/api/tickets?${params}`)
      .then((r) => r.json())
      .then(({ tickets: rows, total: t }) => {
        setTickets((prev) => reset ? rows : [...prev, ...rows]);
        setTotal(t);
        setOffset(off + rows.length);
      })
      .catch(() => { if (reset) setTickets([]); })
      .finally(() => setLoading(false));
  }

  // initial load
  useEffect(() => {
    fetchTickets({ reset: true });
    fetch('/api/labels').then(r => r.json()).then(setAllLabels).catch(console.error);
  }, []);

  // debounced refetch on filter change
  useEffect(() => {
    const timer = setTimeout(() => fetchTickets({ reset: true, s: search, d: dept, from: dateFrom, to: dateTo, off: 0 }), 300);
    return () => clearTimeout(timer);
  }, [search, dept, dateFrom, dateTo]);

  useEffect(() => {
    if (!preview) return;
    fetch(`/api/messages?ticketId=${preview.id}`)
      .then((r) => r.json())
      .then(setMessages)
      .catch(() => setMessages([]));
  }, [preview?.id]);

  function duration(t) {
    if (!t.closedAt || !t.createdAt) return '—';
    const m = Math.round((new Date(t.closedAt) - new Date(t.createdAt)) / 60000);
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  function fmt(iso) {
    return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  }

  return (
    <div className="flex gap-4 items-start">
      {/* Table panel */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <h2 className="text-xl font-bold text-gray-800 dark:text-white mr-auto">Archive</h2>
          <button
            onClick={() => {
              const params = new URLSearchParams();
              if (dept !== 'all') params.set('dept', dept);
              if (search.trim()) params.set('search', search.trim());
              if (dateFrom) params.set('dateFrom', dateFrom);
              if (dateTo) params.set('dateTo', dateTo);

              window.open(`/api/export?${params.toString()}`, '_blank');
            }}
            className="flex items-center gap-2 bg-brand-50 dark:bg-brand-900/40 hover:bg-brand-100 dark:hover:bg-brand-800 text-brand-700 dark:text-brand-300 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border border-brand-200 dark:border-brand-700/50 mr-2 shadow-sm"
            title={t('export_csv')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {t('export_csv')}
          </button>
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agent, CDBID, Dare Ref, expert…"
            className="border border-gray-200 dark:border-brand-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-56 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
          <div className="flex gap-1">
            {['all', 'DSC', 'FOT'].map((d) => (
              <button key={d} onClick={() => setDept(d)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${dept === d ? 'bg-brand-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                {d === 'all' ? 'All' : d}
              </button>
            ))}
          </div>
          {allLabels.length > 0 && (
            <select
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
              className="border border-gray-200 dark:border-brand-600 rounded-lg px-2 py-1.5 text-xs font-medium bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="all">All labels</option>
              <option value="none">No label</option>
              <option value="any">Has label</option>
              {allLabels.map(l => (
                <option key={l.id} value={l.id}>{l.text}</option>
              ))}
            </select>
          )}
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="border border-gray-200 dark:border-brand-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500" />
          <span className="text-gray-400 text-xs">→</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="border border-gray-200 dark:border-brand-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500" />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-xs text-gray-400 hover:text-brand-500 transition-colors">✕ Clear dates</button>
          )}
        </div>

        <div className="bg-white dark:bg-brand-800 rounded-xl shadow-sm border border-gray-100 dark:border-brand-700 overflow-hidden">
          <div className="overflow-x-auto">
            {tickets.length === 0 && !loading ? (
              <p className="text-center text-gray-400 py-12 text-sm">No results.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white dark:bg-brand-800">
                  <tr className="border-b border-gray-100 dark:border-brand-700 text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    <th className="px-4 py-3">Dept</th>
                    <th className="px-4 py-3">Agent</th>
                    <th className="px-4 py-3">Ref</th>
                    <th className="px-4 py-3">Expert</th>
                    <th className="px-4 py-3">Labels</th>
                    <th className="px-4 py-3">Duration</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Closed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                  {tickets.filter(ticket => {
                    if (labelFilter === 'all') return true;
                    if (labelFilter === 'none') return !ticket.labels || ticket.labels.length === 0;
                    if (labelFilter === 'any') return ticket.labels && ticket.labels.length > 0;
                    return ticket.labels && ticket.labels.includes(labelFilter);
                  }).map((ticket) => (
                    <tr
                      key={ticket.id}
                      onClick={() => setPreview(preview?.id === ticket.id ? null : ticket)}
                      className={`cursor-pointer transition-colors ${preview?.id === ticket.id ? 'bg-brand-50 dark:bg-brand-900/20' : 'hover:bg-gray-50 dark:hover:bg-brand-700'}`}
                    >
                      <td className="px-4 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${DEPT_COLOR[ticket.dept]}`}>{ticket.dept}</span>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-gray-800 dark:text-gray-100">{ticket.agentName}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-brand-600 dark:text-brand-400">
                        {ticket.cdbId ? `CDBID: ${ticket.cdbId}` : ticket.dareRef ? `Dare Ref: ${ticket.dareRef}` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{ticket.expertName || <span className="italic text-gray-300">Abandoned</span>}</td>
                      <td className="px-4 py-2.5">
                        {ticket.labels && ticket.labels.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {ticket.labels.map(id => {
                              const info = allLabels.find(l => l.id === id);
                              if (!info) return null;
                              return (
                                <span key={id} className={`text-[10px] font-bold px-1.5 py-0.5 rounded bg-${info.color}-100 text-${info.color}-700 dark:bg-${info.color}-900/30 dark:text-${info.color}-400`}>
                                  {info.text}
                                </span>
                              );
                            })}
                          </div>
                        ) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{duration(ticket)}</td>
                      <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{fmt(ticket.createdAt)}</td>
                      <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{fmt(ticket.closedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-4 py-3 border-t border-gray-100 dark:border-brand-700 flex items-center justify-between shrink-0">
            <span className="text-xs text-gray-400">{tickets.length} of {total} chats</span>
            {tickets.length < total && (
              <button
                onClick={() => fetchTickets({ off: offset })}
                disabled={loading}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-brand-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-brand-700 disabled:opacity-40 transition-colors"
              >
                {loading ? 'Loading…' : `Load more (${total - tickets.length} remaining)`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sliding Drawer for Chat Preview */}
      {
        preview && (
          <div className="fixed inset-0 z-50 flex justify-end">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-brand-900/40 backdrop-blur-sm transition-opacity animate-fade-in"
              onClick={() => setPreview(null)}
            ></div>

            {/* Drawer Panel */}
            <div className="relative w-full max-w-[550px] bg-white dark:bg-brand-800 shadow-2xl border-l border-gray-200 dark:border-brand-700 h-full flex flex-col animate-slide-in-right">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-brand-700 flex items-start justify-between gap-3 shrink-0 bg-gray-50/50 dark:bg-brand-900/20">
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${DEPT_COLOR[preview.dept]}`}>{preview.dept}</span>
                    <span className="text-base font-bold text-gray-800 dark:text-gray-100">{preview.agentName}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-mono text-gray-500 dark:text-gray-400">
                    {preview.cdbId && <span className="bg-gray-100 dark:bg-brand-700 px-2 py-0.5 rounded">CDBID: {preview.cdbId}</span>}
                    {preview.dareRef && <span className="bg-gray-100 dark:bg-brand-700 px-2 py-0.5 rounded">Dare Ref: {preview.dareRef}</span>}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                    </svg>
                    {preview.expertName ? `Expert: ${preview.expertName}` : 'No expert joined'}
                    <span className="text-gray-300 dark:text-brand-600">•</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                    </svg>
                    {duration(preview)}
                  </p>
                  {/* Labels Display */}
                  {preview.labels && preview.labels.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {preview.labels.map(id => {
                        const info = allLabels.find(l => l.id === id);
                        if (!info) return null;
                        return (
                          <span
                            key={id}
                            className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-${info.color}-500/10 text-${info.color}-600 dark:text-${info.color}-400 border border-${info.color}-500/20`}
                          >
                            {info.text}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setPreview(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:bg-brand-700 dark:text-gray-400 dark:hover:bg-brand-600 dark:hover:text-white transition-colors shrink-0"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 bg-gray-50/30 dark:bg-transparent">
                {messages.length === 0
                  ? <p className="text-center text-gray-400 text-sm mt-8">No messages.</p>
                  : messages.map((msg) => (
                    <div key={msg.id} className={`flex gap-3 px-3 py-2 rounded-xl border border-transparent ${msg.whisper ? 'bg-violet-50 dark:bg-violet-900/10 border-violet-100 dark:border-violet-900/30' : 'hover:bg-gray-50 dark:hover:bg-brand-900/20'}`}>
                      <div className="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-700 flex items-center justify-center text-xs font-bold text-brand-700 dark:text-brand-300 shrink-0 shadow-sm">
                        {(msg.senderName || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0 pt-0.5">
                        <div className="flex items-baseline gap-2 mb-1 cursor-default">
                          <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{msg.senderName}</span>
                          <span className="text-xs text-gray-400">{new Date(msg.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                          {msg.whisper && <span className="text-[10px] font-medium uppercase tracking-wider text-violet-500 bg-violet-100 dark:bg-violet-900/50 dark:text-violet-300 px-1.5 py-0.5 rounded leading-none">whisper</span>}
                        </div>
                        <p className={`text-[15px] break-words leading-relaxed ${msg.whisper ? 'text-violet-700 dark:text-violet-300' : 'text-gray-700 dark:text-gray-200'}`}>{msg.text}</p>
                        {msg.mediaUrl && <img src={msg.mediaUrl} alt="screenshot" className="mt-2 rounded-lg max-h-60 object-contain border border-gray-200 dark:border-brand-600 shadow-sm" />}
                      </div>
                    </div>
                  ))
                }
              </div>

              <div className="px-6 py-4 border-t border-gray-100 dark:border-brand-700 shrink-0 bg-gray-50 dark:bg-brand-900/50">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400 flex items-center justify-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                  Read-only archive — conversation closed
                </p>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
}

function Stars({ value }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} xmlns="http://www.w3.org/2000/svg" className={`h-3.5 w-3.5 ${n <= value ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'}`} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </span>
  );
}


function ManagerLabels() {
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState('');
  const [newColor, setNewColor] = useState('rose');
  const [error, setError] = useState(null);

  const fetchLabels = () => {
    setLoading(true);
    setError(null);
    fetch('/api/labels')
      .then(r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}. Please check if the server is running and routes are updated.`);
        return r.json();
      })
      .then(setLabels)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLabels();
  }, []);

  const addLabel = async () => {
    if (!newText.trim()) return;
    setError(null);
    try {
      const res = await fetch('/api/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newText, color: newColor })
      });
      if (res.ok) {
        const added = await res.json();
        setLabels([...labels, added]);
        setNewText('');
      } else {
        setError(`Failed to add label: ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      setError(`Network error: ${err.message}`);
    }
  };

  const deleteLabel = async (id) => {
    try {
      const res = await fetch(`/api/labels/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setLabels(labels.filter(l => l.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const colors = [
    { key: 'rose', bg: 'bg-rose-500', text: 'text-rose-500' },
    { key: 'blue', bg: 'bg-blue-500', text: 'text-blue-500' },
    { key: 'amber', bg: 'bg-amber-500', text: 'text-amber-500' },
    { key: 'emerald', bg: 'bg-emerald-500', text: 'text-emerald-500' },
    { key: 'purple', bg: 'bg-purple-500', text: 'text-purple-500' },
    { key: 'indigo', bg: 'bg-indigo-500', text: 'text-indigo-500' },
  ];

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white tracking-tight">Label Management</h2>
          <p className="text-sm text-gray-400">Manage tags for experts to categorize chats.</p>
        </div>
        <button
          onClick={fetchLabels}
          className="p-2 rounded-lg bg-gray-100 dark:bg-brand-900/50 text-gray-500 hover:text-brand-500 transition-colors"
          title="Refresh Labels"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 rounded-xl flex items-center gap-3 animate-shake">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span className="text-sm font-medium text-red-700 dark:text-red-300">{error}</span>
        </div>
      )}

      <div className="glass-card p-6 shadow-soft">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Create New Label</h3>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase">Label Name</label>
            <input
              type="text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="e.g. Bug Report"
              className="w-full bg-gray-50 dark:bg-brand-900 border border-gray-200 dark:border-brand-700 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none transition-all dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase">Color</label>
            <div className="flex gap-2 p-1.5 bg-gray-50 dark:bg-brand-900 border border-gray-200 dark:border-brand-700 rounded-xl">
              {colors.map(c => (
                <button
                  key={c.key}
                  onClick={() => setNewColor(c.key)}
                  className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${c.bg} ${newColor === c.key ? 'ring-2 ring-offset-2 ring-brand-500 dark:ring-offset-brand-900 scale-110' : 'opacity-60 hover:opacity-100'}`}
                />
              ))}
            </div>
          </div>
          <button
            onClick={addLabel}
            disabled={!newText.trim()}
            className="bg-brand-500 hover:bg-brand-600 text-white px-6 py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-brand-500/20"
          >
            Add Label
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {loading ? (
          <p className="text-gray-400">Loading labels...</p>
        ) : labels.length === 0 ? (
          <p className="col-span-2 text-center py-12 text-gray-400 bg-gray-50 dark:bg-brand-900/40 rounded-2xl border-2 border-dashed border-gray-100 dark:border-brand-700">
            No labels created yet. Add one above!
          </p>
        ) : (
          labels.map(l => (
            <div key={l.id} className="bg-white dark:bg-brand-800 rounded-2xl border border-gray-100 dark:border-brand-700 p-4 flex items-center justify-between group hover:shadow-md transition-all animate-slide-up">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full bg-${l.color}-500 shadow-sm shadow-${l.color}-500/40`} />
                <span className="font-bold text-gray-800 dark:text-gray-100">{l.text}</span>
              </div>
              <button
                onClick={() => deleteLabel(l.id)}
                className="opacity-0 group-hover:opacity-100 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                title="Delete Label"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ManagerFeedback() {
  const [feedback, setFeedback] = useState([]);
  const [ratings, setRatings] = useState([]);
  const [loadingFeedback, setLoadingFeedback] = useState(true);
  const [loadingRatings, setLoadingRatings] = useState(true);
  const [users, setUsers] = useState([]);
  const [tab, setTab] = useState('feedback');
  const [showDismissed, setShowDismissed] = useState(false);
  const [selectedExpert, setSelectedExpert] = useState('ALL');

  useEffect(() => {
    fetch('/api/feedback')
      .then((r) => r.json())
      .then((data) => setFeedback(data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))))
      .catch(() => { })
      .finally(() => setLoadingFeedback(false));

    fetch('/api/ratings')
      .then((r) => r.json())
      .then((data) => setRatings(data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))))
      .catch(() => { })
      .finally(() => setLoadingRatings(false));

    fetch('/api/users')
      .then((r) => r.json())
      .then((data) => setUsers(data))
      .catch(() => { });
  }, []);

  const markTreated = async (id) => {
    try {
      const res = await fetch(`/api/feedback/${id}/treat`, { method: 'PATCH' });
      if (res.ok) {
        setFeedback(feedback.map(f => f.id === id ? { ...f, treated: true } : f));
      }
    } catch (err) {
      console.error('Failed to mark treated', err);
    }
  };

  // Helper to map agentId to dept and expertId to name
  const agentDeptMap = {};
  const expertNameMap = {};
  users.forEach((u) => {
    if (u.role === 'agent') agentDeptMap[u.id] = u.dept;
    if (u.role === 'expert') expertNameMap[u.id] = u.name;
  });

  // Rating stats per expert
  const expertRatings = {};
  ratings.forEach((r) => {
    const name = expertNameMap[r.expertId] || r.expertId || 'Unknown';
    if (!expertRatings[name]) {
      expertRatings[name] = { total: 0, sum: 0, ratings: [], depts: { DSC: { total: 0, sum: 0, count5: 0, countLow: 0 }, FOT: { total: 0, sum: 0, count5: 0, countLow: 0 } } };
    }
    expertRatings[name].total++;
    expertRatings[name].sum += r.rating;
    expertRatings[name].ratings.push(r);

    const dept = agentDeptMap[r.agentId];
    if (dept && expertRatings[name].depts[dept]) {
      const d = expertRatings[name].depts[dept];
      d.total++;
      d.sum += r.rating;
      if (r.rating === 5) d.count5++;
      if (r.rating <= 2) d.countLow++;
    }
  });

  const activeFeedback = feedback.filter(f => !f.treated);
  const dismissedFeedback = feedback.filter(f => f.treated);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">Feedback & Ratings</h2>
        <div className="flex gap-1">
          <button
            onClick={() => setTab('feedback')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === 'feedback' ? 'bg-brand-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
          >
            Feedback ({feedback.length})
          </button>
          <button
            onClick={() => setTab('ratings')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === 'ratings' ? 'bg-brand-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
          >
            Ratings ({ratings.length})
          </button>
        </div>
      </div>

      {tab === 'feedback' && (
        <div className="space-y-6 animate-fade-in">
          <div className="space-y-3">
            {loadingFeedback ? (
              <p className="text-gray-400 text-sm">Loading...</p>
            ) : activeFeedback.length === 0 ? (
              <div className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 p-8 text-center shadow-sm">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-brand-200 dark:text-brand-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">All caught up! No active feedback.</p>
              </div>
            ) : (
              activeFeedback.map((f) => (
                <div key={f.id} className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 p-5 shadow-sm hover:shadow-md transition-all group animate-slide-up">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-100 to-brand-200 dark:from-brand-800 dark:to-brand-700 flex items-center justify-center text-sm font-bold text-brand-700 dark:text-brand-300 shadow-inner">
                        {(f.userName || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{f.userName}</span>
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-gray-100 dark:bg-brand-900/50 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded">{f.role}</span>
                        </div>
                        <span className="text-xs text-gray-400">
                          {new Date(f.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => markTreated(f.id)}
                      className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-green-600 bg-gray-50 hover:bg-green-50 dark:bg-brand-900/30 dark:hover:bg-green-900/30 dark:border-brand-800 border border-gray-100 px-3 py-1.5 rounded-lg transition-all shadow-sm"
                      title="Mark as treated"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                      Dismiss
                    </button>
                  </div>
                  <p className="text-[15px] text-gray-700 dark:text-gray-300 leading-relaxed pl-13">{f.text}</p>
                </div>
              ))
            )}
          </div>

          {/* Dismissed Feedback Accordion */}
          {dismissedFeedback.length > 0 && (
            <div className="mt-8 border-t border-gray-200 dark:border-brand-700/50 pt-6">
              <button
                onClick={() => setShowDismissed(!showDismissed)}
                className="w-full flex items-center justify-between text-left p-4 rounded-xl bg-gray-50 dark:bg-brand-900/40 hover:bg-gray-100 dark:hover:bg-brand-800/60 transition-colors border border-gray-100 dark:border-brand-800/50"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-gray-700 dark:text-gray-300">Dismissed Feedback</span>
                  <span className="bg-white dark:bg-brand-800 text-gray-500 dark:text-gray-400 text-xs font-semibold px-2.5 py-1 rounded-full shadow-sm">{dismissedFeedback.length}</span>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 text-gray-400 transition-transform duration-300 ${showDismissed ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>

              {showDismissed && (
                <div className="mt-3 space-y-3 animate-slide-up">
                  {dismissedFeedback.map((f) => (
                    <div key={f.id} className="bg-white/60 dark:bg-brand-800/60 rounded-xl border border-gray-100 dark:border-brand-700/50 p-4 opacity-75 backdrop-blur-sm">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">{f.userName}</span>
                          <span className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500">{f.role}</span>
                          <span className="text-xs bg-green-100/50 text-green-700 dark:bg-green-900/20 dark:text-green-500 px-2 py-0.5 rounded-full flex items-center gap-1 font-medium ring-1 ring-green-200/50 dark:ring-green-800/30">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                            Treated
                          </span>
                        </div>
                        <span className="text-xs text-gray-400">
                          {new Date(f.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 whitespace-pre-wrap">{f.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'ratings' && (
        <div className="space-y-4">
          {loadingRatings ? (
            <p className="text-gray-400 text-sm">Loading...</p>
          ) : ratings.length === 0 ? (
            <div className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 p-8 text-center">
              <p className="text-gray-400 text-sm">No ratings submitted yet.</p>
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 p-4">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Total ratings</p>
                  <p className="text-2xl font-bold text-gray-800 dark:text-white mt-1">{ratings.length}</p>
                </div>
                <div className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 p-4">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Average</p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-2xl font-bold text-amber-500">
                      {(ratings.reduce((s, r) => s + r.rating, 0) / ratings.length).toFixed(1)}
                    </p>
                    <Stars value={Math.round(ratings.reduce((s, r) => s + r.rating, 0) / ratings.length)} />
                  </div>
                </div>
                <div className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 p-4">
                  <p className="text-xs text-gray-500 dark:text-gray-400">5-star</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">
                    {ratings.filter((r) => r.rating === 5).length}
                  </p>
                </div>
                <div className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 p-4">
                  <p className="text-xs text-gray-500 dark:text-gray-400">1-2 star</p>
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">
                    {ratings.filter((r) => r.rating <= 2).length}
                  </p>
                </div>
              </div>

              {/* Rating distribution bar */}
              <div className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 p-4">
                <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-3">Distribution</p>
                <div className="space-y-2">
                  {[5, 4, 3, 2, 1].map((star) => {
                    const count = ratings.filter((r) => r.rating === star).length;
                    const pct = ratings.length > 0 ? (count / ratings.length) * 100 : 0;
                    return (
                      <div key={star} className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400 w-3 text-right">{star}</span>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-amber-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                        <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-gray-400 w-8">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Ratings by Expert */}
              {Object.keys(expertRatings).length > 0 && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-8 mb-4">
                    <p className="text-lg font-bold text-gray-800 dark:text-white">Ratings by Expert</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">View:</span>
                      <select
                        value={selectedExpert}
                        onChange={(e) => setSelectedExpert(e.target.value)}
                        className="text-sm bg-white dark:bg-brand-900 border border-gray-200 dark:border-brand-700 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-brand-500 outline-none transition-all text-gray-700 dark:text-gray-200 shadow-sm"
                      >
                        <option value="ALL">All Experts (Overview)</option>
                        {Object.keys(expertRatings).sort().map(name => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {selectedExpert === 'ALL' ? (
                    <div className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 overflow-hidden shadow-sm animate-fade-in">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm border-collapse">
                          <thead>
                            <tr className="bg-gray-50/50 dark:bg-brand-900/40 border-b border-gray-100 dark:border-brand-700">
                              <th className="px-6 py-4 font-bold text-gray-700 dark:text-gray-300">Expert Name</th>
                              <th className="px-6 py-4 font-bold text-gray-700 dark:text-gray-300 text-center">Avg Rating</th>
                              <th className="px-6 py-4 font-bold text-gray-700 dark:text-gray-300 text-center">Trend</th>
                              <th className="px-6 py-4 font-bold text-gray-700 dark:text-gray-300 text-center">Total</th>
                              <th className="px-6 py-4 font-bold text-gray-700 dark:text-gray-300 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50 dark:divide-brand-700/50">
                            {Object.entries(expertRatings).sort((a, b) => b[1].total - a[1].total).map(([name, e]) => {
                              const avg = (e.sum / e.total).toFixed(1);
                              return (
                                <tr key={name} className="hover:bg-gray-50/80 dark:hover:bg-brand-700/30 transition-colors">
                                  <td className="px-6 py-4">
                                    <span className="font-bold text-gray-800 dark:text-gray-100">{name}</span>
                                  </td>
                                  <td className="px-6 py-4">
                                    <div className="flex items-center justify-center gap-2">
                                      <span className={`font-bold ${parseFloat(avg) >= 4 ? 'text-green-500' : parseFloat(avg) >= 3 ? 'text-amber-500' : 'text-red-500'}`}>{avg}</span>
                                      <Stars value={Math.round(e.sum / e.total)} />
                                    </div>
                                  </td>
                                  <td className="px-6 py-4">
                                    <div className="flex items-center justify-center gap-4 text-xs font-semibold">
                                      <span className="text-green-500">5★ ({e.ratings.filter(r => r.rating === 5).length})</span>
                                      <span className="text-red-500">1-2★ ({e.ratings.filter(r => r.rating <= 2).length})</span>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 text-center">
                                    <span className="bg-gray-100 dark:bg-brand-900/50 text-gray-600 dark:text-brand-300 px-2 py-1 rounded text-xs font-bold">{e.total}</span>
                                  </td>
                                  <td className="px-6 py-4 text-right">
                                    <button
                                      onClick={() => setSelectedExpert(name)}
                                      className="text-brand-500 hover:text-brand-600 font-bold text-xs"
                                    >
                                      Details
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="animate-fade-in">
                      {(() => {
                        const e = expertRatings[selectedExpert];
                        if (!e) return null;
                        const avg = (e.sum / e.total).toFixed(1);
                        return (
                          <div className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 p-6 shadow-md shadow-brand-500/5">
                            <div className="flex items-center justify-between mb-4 border-b border-gray-100 dark:border-brand-700 pb-4">
                              <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-brand-500 text-white flex items-center justify-center text-xl font-bold shadow-lg shadow-brand-500/20">
                                  {selectedExpert[0]}
                                </div>
                                <h3 className="font-bold text-xl text-gray-800 dark:text-white">{selectedExpert}</h3>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="text-right">
                                  <p className="text-2xl font-bold text-amber-500 leading-none">{avg}</p>
                                  <div className="mt-1"><Stars value={Math.round(e.sum / e.total)} /></div>
                                </div>
                                <div className="h-10 w-px bg-gray-100 dark:bg-brand-700 mx-1" />
                                <div className="bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300 px-4 py-2 rounded-xl text-center">
                                  <p className="text-[10px] font-bold uppercase tracking-wider opacity-60">Total Ratings</p>
                                  <p className="text-lg font-bold">{e.total}</p>
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                              {/* DSC Breakdown */}
                              <div className="bg-gray-50 dark:bg-brand-900/30 rounded-xl p-5 border border-gray-100 dark:border-brand-700/50 relative overflow-hidden group">
                                <div className="flex justify-between items-center mb-4">
                                  <div>
                                    <span className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-widest">DSC</span>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Customer Support</p>
                                  </div>
                                  <span className="text-xs font-bold bg-white dark:bg-brand-800 text-brand-600 dark:text-brand-400 px-3 py-1 rounded-full shadow-sm">
                                    {e.depts.DSC.total} ratings
                                  </span>
                                </div>
                                {e.depts.DSC.total > 0 ? (
                                  <div className="space-y-3">
                                    <div className="flex justify-between items-center bg-white dark:bg-brand-800/50 p-2 rounded-lg">
                                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Average Score</span>
                                      <span className="text-lg font-bold text-amber-500">{(e.depts.DSC.sum / e.depts.DSC.total).toFixed(1)}</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="bg-green-50/50 dark:bg-green-900/20 p-2 rounded-lg text-center border border-green-100 dark:border-green-900/30">
                                        <span className="block text-[10px] text-green-600 dark:text-green-400 font-bold uppercase">5 Stars</span>
                                        <span className="text-lg font-bold text-green-700 dark:text-green-300">{e.depts.DSC.count5}</span>
                                      </div>
                                      <div className="bg-red-50/50 dark:bg-red-900/20 p-2 rounded-lg text-center border border-red-100 dark:border-red-900/30">
                                        <span className="block text-[10px] text-red-600 dark:text-red-400 font-bold uppercase">1-2 Stars</span>
                                        <span className="text-lg font-bold text-red-700 dark:text-red-300">{e.depts.DSC.countLow}</span>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="py-6 text-center border-2 border-dashed border-gray-100 dark:border-brand-700 rounded-xl">
                                    <p className="text-sm text-gray-400">No DSC ratings</p>
                                  </div>
                                )}
                              </div>

                              {/* FOT Breakdown */}
                              <div className="bg-gray-50 dark:bg-brand-900/30 rounded-xl p-5 border border-gray-100 dark:border-brand-700/50">
                                <div className="flex justify-between items-center mb-4">
                                  <div>
                                    <span className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-widest">FOT</span>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Front Office Team</p>
                                  </div>
                                  <span className="text-xs font-bold bg-white dark:bg-brand-800 text-brand-600 dark:text-brand-400 px-3 py-1 rounded-full shadow-sm">
                                    {e.depts.FOT.total} ratings
                                  </span>
                                </div>
                                {e.depts.FOT.total > 0 ? (
                                  <div className="space-y-3">
                                    <div className="flex justify-between items-center bg-white dark:bg-brand-800/50 p-2 rounded-lg">
                                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Average Score</span>
                                      <span className="text-lg font-bold text-amber-500">{(e.depts.FOT.sum / e.depts.FOT.total).toFixed(1)}</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="bg-green-50/50 dark:bg-green-900/20 p-2 rounded-lg text-center border border-green-100 dark:border-green-900/30">
                                        <span className="block text-[10px] text-green-600 dark:text-green-400 font-bold uppercase">5 Stars</span>
                                        <span className="text-lg font-bold text-green-700 dark:text-green-300">{e.depts.FOT.count5}</span>
                                      </div>
                                      <div className="bg-red-50/50 dark:bg-red-900/20 p-2 rounded-lg text-center border border-red-100 dark:border-red-900/30">
                                        <span className="block text-[10px] text-red-600 dark:text-red-400 font-bold uppercase">1-2 Stars</span>
                                        <span className="text-lg font-bold text-red-700 dark:text-red-300">{e.depts.FOT.countLow}</span>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="py-6 text-center border-2 border-dashed border-gray-100 dark:border-brand-700 rounded-xl">
                                    <p className="text-sm text-gray-400">No FOT ratings</p>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="mt-6 flex justify-center">
                              <button
                                onClick={() => setSelectedExpert('ALL')}
                                className="text-xs font-bold text-gray-500 dark:text-gray-400 hover:text-brand-500 transition-colors flex items-center gap-2"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                                </svg>
                                Back to Overview
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}

              {/* Individual ratings */}
              <div className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 overflow-hidden">
                <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 px-4 py-3 border-b border-gray-100 dark:border-brand-700">Recent ratings</p>
                <div className="divide-y divide-gray-50 dark:divide-gray-700">
                  {ratings.slice(0, 50).map((r) => (
                    <div key={r.id} className="px-4 py-3 flex items-start gap-3">
                      <Stars value={r.rating} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            Agent: <span className="font-medium text-gray-700 dark:text-gray-200">{r.agentId}</span>
                          </span>
                          {r.expertId && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              Expert: <span className="font-medium text-gray-700 dark:text-gray-200">{r.expertId}</span>
                            </span>
                          )}
                          <span className="text-xs text-gray-400">
                            {new Date(r.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                        </div>
                        {r.comment && (
                          <p className="text-sm text-gray-700 dark:text-gray-200 mt-1">{r.comment}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div className="glass-card p-5 shadow-soft border-white/40 dark:border-brand-700/50 hover:shadow-lg transition-shadow duration-300">
      <p className="text-sm font-semibold text-slate-700 dark:text-gray-300 mb-4 tracking-wide uppercase">{title}</p>
      {children}
    </div>
  );
}

function StatCard({ label, value, color }) {
  const colors = {
    red: 'bg-gradient-to-br from-rose-50 to-rose-100/50 text-rose-600 border-rose-200/50 dark:from-rose-900/30 dark:to-transparent dark:text-rose-400 dark:border-rose-900/50',
    yellow: 'bg-gradient-to-br from-amber-50 to-amber-100/50 text-amber-700 border-amber-200/50 dark:from-amber-900/30 dark:to-transparent dark:text-amber-400 dark:border-amber-900/50',
    green: 'bg-gradient-to-br from-emerald-50 to-emerald-100/50 text-emerald-700 border-emerald-200/50 dark:from-emerald-900/30 dark:to-transparent dark:text-emerald-400 dark:border-emerald-900/50',
    purple: 'bg-gradient-to-br from-purple-50 to-purple-100/50 text-purple-700 border-purple-200/50 dark:from-purple-900/30 dark:to-transparent dark:text-purple-400 dark:border-purple-900/50',
    teal: 'bg-gradient-to-br from-teal-50 to-teal-100/50 text-teal-700 border-teal-200/50 dark:from-teal-900/30 dark:to-transparent dark:text-teal-400 dark:border-teal-900/50',
    gray: 'bg-gradient-to-br from-slate-50 to-slate-100/50 text-slate-600 border-slate-200/50 dark:from-slate-800/50 dark:to-transparent dark:text-slate-300 dark:border-slate-700/50',
    dark: 'bg-gradient-to-br from-slate-800 to-slate-900 text-white border-slate-700/50 shadow-md',
  };
  return (
    <div className={`rounded-xl border p-5 shadow-sm hover:-translate-y-1 hover:shadow-md transition-all duration-300 ${colors[color] || colors.gray}`}>
      <p className="text-sm font-medium opacity-80 tracking-tight">{label}</p>
      <p className="text-3xl font-bold mt-1.5">{value}</p>
    </div>
  );
}

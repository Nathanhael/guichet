import { useState, useEffect } from 'react';
import { Stars, Skeleton } from './DashboardHelpers';
import { Rating, FeedbackItem, User } from '../../types';
import useStore from '../../store/useStore';
import { trpc } from '../../utils/trpc';

interface ExpertRatings {
  [key: string]: {
    total: number;
    sum: number;
    ratings: Rating[];
    depts: {
      [key: string]: {
        total: number;
        sum: number;
        count5: number;
        countLow: number;
      };
    };
  };
}

export default function AdminFeedback() {
  const { token } = useStore();
  const [tab, setTab] = useState<'feedback' | 'ratings'>('feedback');
  const [showDismissed, setShowDismissed] = useState(false);
  const [selectedExpert, setSelectedExpert] = useState('ALL');

  // tRPC: Feedback List
  const feedbackQuery = trpc.feedback.list.useQuery();
  
  // tRPC: Ratings List
  const ratingsQuery = trpc.rating.list.useQuery();

  // tRPC: Mark Treated
  const markTreatedMutation = trpc.feedback.markTreated.useMutation({
    onSuccess: () => {
      feedbackQuery.refetch();
    }
  });

  // tRPC: Users List
  const { data: usersData } = trpc.user.list.useQuery();

  const users = usersData || [];
  const feedback = feedbackQuery.data || [];
  const ratings = (ratingsQuery.data || []) as Rating[];
  const loadingFeedback = feedbackQuery.isLoading;
  const loadingRatings = ratingsQuery.isLoading;

  const markTreated = async (id: string) => {
    markTreatedMutation.mutate(id);
  };

  const agentDeptMap: Record<string, string> = {};
  const expertNameMap: Record<string, string> = {};
  users.forEach((u) => {
    if (u.role === 'agent') agentDeptMap[u.id] = u.dept;
    if (u.role === 'expert') expertNameMap[u.id] = u.name;
  });

  const expertRatings: ExpertRatings = {};
  ratings.forEach((r) => {
    const name = expertNameMap[r.expertId || ''] || r.expertId || 'Unknown';
    if (!expertRatings[name]) {
      expertRatings[name] = {
        total: 0,
        sum: 0,
        ratings: [],
        depts: {
          DSC: { total: 0, sum: 0, count5: 0, countLow: 0 },
          FOT: { total: 0, sum: 0, count5: 0, countLow: 0 },
        },
      };
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

  const activeFeedback = feedback.filter((f) => !f.treated);
  const dismissedFeedback = feedback.filter((f) => f.treated);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-bold text-solarized-base01 dark:text-white">Feedback & Ratings</h2>
        <div className="flex gap-1">
          <button
            onClick={() => setTab('feedback')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              tab === 'feedback'
                ? 'bg-brand-500 text-white'
                : 'bg-solarized-base2 dark:bg-gray-700 text-solarized-base1 dark:text-gray-400 hover:bg-solarized-base2 hover:text-solarized-base01 dark:hover:bg-gray-600'
            }`}
          >
            Feedback ({feedback.length})
          </button>
          <button
            onClick={() => setTab('ratings')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              tab === 'ratings'
                ? 'bg-brand-500 text-white'
                : 'bg-solarized-base2 dark:bg-gray-700 text-solarized-base1 dark:text-gray-400 hover:bg-solarized-base2 hover:text-solarized-base01 dark:hover:bg-gray-600'
            }`}
          >
            Ratings ({ratings.length})
          </button>
        </div>
      </div>

      {tab === 'feedback' && (
        <div className="space-y-6 animate-fade-in">
          <div className="space-y-3">
            {loadingFeedback ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-32 w-full rounded-xl" />
                ))}
              </div>
            ) : activeFeedback.length === 0 ? (
              <div className="bg-solarized-base3 dark:bg-brand-800 rounded-xl border border-solarized-base2 dark:border-brand-700 p-8 text-center shadow-sm">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-12 w-12 mx-auto text-solarized-base2 dark:text-brand-700 mb-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-solarized-base1 dark:text-gray-400 text-sm font-medium">All caught up! No active feedback.</p>
              </div>
            ) : (
              activeFeedback.map((f) => (
                <div
                  key={f.id}
                  className="bg-solarized-base3 dark:bg-brand-800 rounded-xl border border-solarized-base2 dark:border-brand-700 p-5 shadow-sm hover:shadow-md transition-all group animate-slide-up"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-100 to-brand-200 dark:from-brand-800 dark:to-brand-700 flex items-center justify-center text-sm font-bold text-brand-700 dark:text-brand-300 shadow-inner">
                        {(f.userName || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-solarized-base01 dark:text-gray-100">{f.userName}</span>
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-solarized-base2 dark:bg-brand-900/50 text-solarized-base1 dark:text-gray-400 px-2 py-0.5 rounded">
                            {f.role}
                          </span>
                        </div>
                        <span className="text-xs text-solarized-base1">
                          {new Date(f.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => markTreated(f.id)}
                      disabled={markTreatedMutation.isPending}
                      className="flex items-center gap-1.5 text-xs font-medium text-solarized-base1 hover:text-green-600 bg-solarized-base2 hover:bg-green-50 dark:bg-brand-900/30 dark:hover:bg-green-900/30 dark:border-brand-800 border border-solarized-base2 px-3 py-1.5 rounded-lg transition-all shadow-sm disabled:opacity-50"
                      title="Mark as treated"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                      {markTreatedMutation.isPending ? 'Processing...' : 'Dismiss'}
                    </button>
                  </div>
                  <p className="text-[15px] text-solarized-base01 dark:text-gray-300 leading-relaxed pl-13">{f.text}</p>
                </div>
              ))
            )}
          </div>

          {dismissedFeedback.length > 0 && (
            <div className="mt-8 border-t border-solarized-base2 dark:border-brand-700/50 pt-6">
              <button
                onClick={() => setShowDismissed(!showDismissed)}
                className="w-full flex items-center justify-between text-left p-4 rounded-xl bg-solarized-base2 dark:bg-brand-900/40 hover:bg-solarized-base2 dark:hover:bg-brand-800/60 transition-colors border border-solarized-base2 dark:border-brand-800/50"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-solarized-base01 dark:text-gray-300">Dismissed Feedback</span>
                  <span className="bg-solarized-base3 dark:bg-brand-800 text-solarized-base1 dark:text-gray-400 text-xs font-semibold px-2.5 py-1 rounded-full shadow-sm">
                    {dismissedFeedback.length}
                  </span>
                </div>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className={`h-5 w-5 text-solarized-base1 transition-transform duration-300 ${showDismissed ? 'rotate-180' : ''}`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              {showDismissed && (
                <div className="mt-3 space-y-3 animate-slide-up">
                  {dismissedFeedback.map((f) => (
                    <div
                      key={f.id}
                      className="bg-solarized-base3/60 dark:bg-brand-800/60 rounded-xl border border-solarized-base2 dark:border-brand-700/50 p-4 opacity-75 backdrop-blur-sm"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-solarized-base01 dark:text-gray-400">{f.userName}</span>
                          <span className="text-[10px] uppercase font-bold text-solarized-base1 dark:text-gray-500">{f.role}</span>
                          <span className="text-xs bg-green-100/50 text-green-700 dark:bg-green-900/20 dark:text-green-500 px-2 py-0.5 rounded-full flex items-center gap-1 font-medium ring-1 ring-green-200/50 dark:ring-green-800/30">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                            Treated
                          </span>
                        </div>
                        <span className="text-xs text-solarized-base1">
                          {new Date(f.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                      </div>
                      <p className="text-sm text-solarized-base1 dark:text-gray-400 whitespace-pre-wrap">{f.text}</p>
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
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-xl" />
                ))}
              </div>
              <Skeleton className="h-40 w-full rounded-xl" />
              <Skeleton className="h-64 w-full rounded-xl" />
            </div>
          ) : ratings.length === 0 ? (
            <div className="bg-solarized-base3 dark:bg-brand-800 rounded-xl border border-solarized-base2 dark:border-brand-700 p-8 text-center">
              <p className="text-solarized-base1 text-sm">No ratings submitted yet.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-solarized-base3 dark:bg-brand-800 rounded-xl border border-solarized-base2 dark:border-brand-700 p-4">
                  <p className="text-xs text-solarized-base1 dark:text-gray-400">Total ratings</p>
                  <p className="text-2xl font-bold text-solarized-base01 dark:text-white mt-1">{ratings.length}</p>
                </div>
                <div className="bg-solarized-base3 dark:bg-brand-800 rounded-xl border border-solarized-base2 dark:border-brand-700 p-4">
                  <p className="text-xs text-solarized-base1 dark:text-gray-400">Average</p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-2xl font-bold text-amber-500">{(ratings.reduce((s, r) => s + r.rating, 0) / ratings.length).toFixed(1)}</p>
                    <Stars value={Math.round(ratings.reduce((s, r) => s + r.rating, 0) / ratings.length)} />
                  </div>
                </div>
                <div className="bg-solarized-base3 dark:bg-brand-800 rounded-xl border border-solarized-base2 dark:border-brand-700 p-4">
                  <p className="text-xs text-solarized-base1 dark:text-gray-400">5-star</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">{ratings.filter((r) => r.rating === 5).length}</p>
                </div>
                <div className="bg-solarized-base3 dark:bg-brand-800 rounded-xl border border-solarized-base2 dark:border-brand-700 p-4">
                  <p className="text-xs text-solarized-base1 dark:text-gray-400">1-2 star</p>
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">{ratings.filter((r) => r.rating <= 2).length}</p>
                </div>
              </div>

              <div className="bg-solarized-base3 dark:bg-brand-800 rounded-xl border border-solarized-base2 dark:border-brand-700 p-4">
                <p className="text-sm font-semibold text-solarized-base01 dark:text-gray-300 mb-3">Distribution</p>
                <div className="space-y-2">
                  {[5, 4, 3, 2, 1].map((star) => {
                    const count = ratings.filter((r) => r.rating === star).length;
                    const pct = ratings.length > 0 ? (count / ratings.length) * 100 : 0;
                    return (
                      <div key={star} className="flex items-center gap-2">
                        <span className="text-xs text-solarized-base1 dark:text-gray-400 w-3 text-right">{star}</span>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-3.5 w-3.5 text-amber-400 shrink-0"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                        >
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                        <div className="flex-1 h-2 bg-solarized-base2 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-solarized-base1 w-8">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {Object.keys(expertRatings).length > 0 && (
                <div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-8 mb-4">
                    <p className="text-lg font-bold text-solarized-base01 dark:text-white">Ratings by Expert</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-solarized-base1 dark:text-gray-400">View:</span>
                      <select
                        value={selectedExpert}
                        onChange={(e) => setSelectedExpert(e.target.value)}
                        className="text-sm bg-solarized-base3 dark:bg-brand-900 border border-solarized-base2 dark:border-brand-700 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-brand-500 outline-none transition-all text-solarized-base01 dark:text-gray-200 shadow-sm"
                      >
                        <option value="ALL">All Experts (Overview)</option>
                        {Object.keys(expertRatings)
                          .sort()
                          .map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  {selectedExpert === 'ALL' ? (
                    <div className="bg-solarized-base3 dark:bg-brand-800 rounded-xl border border-solarized-base2 dark:border-brand-700 overflow-hidden shadow-sm animate-fade-in">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm border-collapse">
                          <thead>
                            <tr className="bg-solarized-base2/50 dark:bg-brand-900/40 border-b border-solarized-base2 dark:border-brand-700">
                              <th className="px-6 py-4 font-bold text-solarized-base01 dark:text-gray-300">Expert Name</th>
                              <th className="px-6 py-4 font-bold text-solarized-base01 dark:text-gray-300 text-center">Avg Rating</th>
                              <th className="px-6 py-4 font-bold text-solarized-base01 dark:text-gray-300 text-center">Trend</th>
                              <th className="px-6 py-4 font-bold text-solarized-base01 dark:text-gray-300 text-center">Total</th>
                              <th className="px-6 py-4 font-bold text-solarized-base01 dark:text-gray-300 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-solarized-base2 dark:divide-brand-700/50">
                            {Object.entries(expertRatings)
                              .sort((a, b) => b[1].total - a[1].total)
                              .map(([name, e]) => {
                                const avg = (e.sum / e.total).toFixed(1);
                                return (
                                  <tr key={name} className="hover:bg-solarized-base2 dark:hover:bg-brand-700/30 transition-colors">
                                    <td className="px-6 py-4">
                                      <span className="font-bold text-solarized-base01 dark:text-gray-100">{name}</span>
                                    </td>
                                    <td className="px-6 py-4">
                                      <div className="flex items-center justify-center gap-2">
                                        <span
                                          className={`font-bold ${
                                            parseFloat(avg) >= 4 ? 'text-green-500' : parseFloat(avg) >= 3 ? 'text-amber-500' : 'text-red-500'
                                          }`}
                                        >
                                          {avg}
                                        </span>
                                        <Stars value={Math.round(e.sum / e.total)} />
                                      </div>
                                    </td>
                                    <td className="px-6 py-4">
                                      <div className="flex items-center justify-center gap-4 text-xs font-semibold">
                                        <span className="text-green-500">5★ ({e.ratings.filter((r) => r.rating === 5).length})</span>
                                        <span className="text-red-500">1-2★ ({e.ratings.filter((r) => r.rating <= 2).length})</span>
                                      </div>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                      <span className="bg-solarized-base2 dark:bg-brand-900/50 text-solarized-base1 dark:text-brand-300 px-2 py-1 rounded text-xs font-bold">
                                        {e.total}
                                      </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                      <button onClick={() => setSelectedExpert(name)} className="text-brand-500 hover:text-brand-600 font-bold text-xs">
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
                          <div className="bg-solarized-base3 dark:bg-brand-800 rounded-xl border border-solarized-base2 dark:border-brand-700 p-6 shadow-md shadow-brand-500/5">
                            <div className="flex items-center justify-between mb-4 border-b border-solarized-base2 dark:border-brand-700 pb-4">
                              <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-brand-500 text-white flex items-center justify-center text-xl font-bold shadow-lg shadow-brand-500/20">
                                  {selectedExpert[0]}
                                </div>
                                <h3 className="font-bold text-xl text-solarized-base01 dark:text-white">{selectedExpert}</h3>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="text-right">
                                  <p className="text-2xl font-bold text-amber-500 leading-none">{avg}</p>
                                  <div className="mt-1">
                                    <Stars value={Math.round(e.sum / e.total)} />
                                  </div>
                                </div>
                                <div className="h-10 w-px bg-solarized-base2 dark:bg-brand-700 mx-1" />
                                <div className="bg-solarized-base2 text-solarized-base1 dark:bg-brand-900/50 dark:text-brand-300 px-4 py-2 rounded-xl text-center">
                                  <p className="text-[10px] font-bold uppercase tracking-wider opacity-60">Total Ratings</p>
                                  <p className="text-lg font-bold">{e.total}</p>
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                              {/* DSC Breakdown */}
                              <div className="bg-solarized-base2 dark:bg-brand-900/30 rounded-xl p-5 border border-solarized-base2 dark:border-brand-700/50 relative overflow-hidden group">
                                <div className="flex justify-between items-center mb-4">
                                  <div>
                                    <span className="text-sm font-bold text-solarized-base01 dark:text-gray-300 uppercase tracking-widest">DSC</span>
                                    <p className="text-xs text-solarized-base1 dark:text-gray-400">Customer Support</p>
                                  </div>
                                  <span className="text-xs font-bold bg-solarized-base3 dark:bg-brand-800 text-brand-600 dark:text-brand-400 px-3 py-1 rounded-full shadow-sm">
                                    {e.depts.DSC.total} ratings
                                  </span>
                                </div>
                                {e.depts.DSC.total > 0 ? (
                                  <div className="space-y-3">
                                    <div className="flex justify-between items-center bg-solarized-base3 dark:bg-brand-800/50 p-2 rounded-lg">
                                      <span className="text-xs font-medium text-solarized-base1 dark:text-gray-400">Average Score</span>
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
                                  <div className="py-6 text-center border-2 border-dashed border-solarized-base2 dark:border-brand-700 rounded-xl">
                                    <p className="text-sm text-solarized-base1">No DSC ratings</p>
                                  </div>
                                )}
                              </div>

                              {/* FOT Breakdown */}
                              <div className="bg-solarized-base2 dark:bg-brand-900/30 rounded-xl p-5 border border-solarized-base2 dark:border-brand-700/50">
                                <div className="flex justify-between items-center mb-4">
                                  <div>
                                    <span className="text-sm font-bold text-solarized-base01 dark:text-gray-300 uppercase tracking-widest">FOT</span>
                                    <p className="text-xs text-solarized-base1 dark:text-gray-400">Front Office Team</p>
                                  </div>
                                  <span className="text-xs font-bold bg-solarized-base3 dark:bg-brand-800 text-brand-600 dark:text-brand-400 px-3 py-1 rounded-full shadow-sm">
                                    {e.depts.FOT.total} ratings
                                  </span>
                                </div>
                                {e.depts.FOT.total > 0 ? (
                                  <div className="space-y-3">
                                    <div className="flex justify-between items-center bg-solarized-base3 dark:bg-brand-800/50 p-2 rounded-lg">
                                      <span className="text-xs font-medium text-solarized-base1 dark:text-gray-400">Average Score</span>
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
                                  <div className="py-6 text-center border-2 border-dashed border-solarized-base2 dark:border-brand-700 rounded-xl">
                                    <p className="text-sm text-solarized-base1">No FOT ratings</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}

              <div className="bg-solarized-base3 dark:bg-brand-800 rounded-xl border border-solarized-base2 dark:border-brand-700 overflow-hidden">
                <p className="text-sm font-semibold text-solarized-base01 dark:text-gray-300 px-4 py-3 border-b border-solarized-base2 dark:border-brand-700">
                  Recent ratings
                </p>
                <div className="divide-y divide-solarized-base2 dark:divide-brand-700">
                  {ratings.slice(0, 50).map((r) => (
                    <div key={r.id} className="px-4 py-3 flex items-start gap-3">
                      <Stars value={r.rating} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-solarized-base1 dark:text-gray-400">
                            Agent:{' '}
                            <span className="font-medium text-solarized-base01 dark:text-gray-200">
                              {expertNameMap[r.agentId] || r.agentId}
                            </span>
                          </span>
                          {r.expertId && (
                            <span className="text-xs text-solarized-base1 dark:text-gray-400">
                              Expert:{' '}
                              <span className="font-medium text-solarized-base01 dark:text-gray-200">
                                {expertNameMap[r.expertId] || r.expertId}
                              </span>
                            </span>
                          )}
                          <span className="text-xs text-solarized-base1">
                            {new Date(r.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                        </div>
                        {r.comment && <p className="text-sm text-solarized-base01 dark:text-gray-200 mt-1">{r.comment}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedExpert !== 'ALL' && (
                <div className="mt-6 flex justify-center">
                  <button
                    onClick={() => setSelectedExpert('ALL')}
                    className="text-xs font-bold text-solarized-base1 dark:text-gray-400 hover:text-brand-500 transition-colors flex items-center gap-2"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    Back to Overview
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { Stars, Skeleton } from './DashboardHelpers';
import { Rating } from '../../types';
import { trpc } from '../../utils/trpc';

interface SupportRatings {
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
  const [tab, setTab] = useState<'feedback' | 'ratings'>('feedback');
  const [showDismissed, setShowDismissed] = useState(false);
  const [selectedSupport, setSelectedSupport] = useState('ALL');

  // tRPC: Feedback List
  const feedbackQuery = trpc.feedback.list.useQuery();

  // tRPC: Ratings List
  const ratingsQuery = trpc.rating.list.useQuery({ limit: 200 });

  // tRPC: Mark Treated
  const markTreatedMutation = trpc.feedback.markTreated.useMutation({
    onSuccess: () => {
      feedbackQuery.refetch();
    }
  });

  // tRPC: Users List
  const { data: usersData } = trpc.user.list.useQuery();

  const users = (usersData?.users || []) as unknown as Array<{ id: string; name: string; email: string; roles: string[] | null; dept?: string }>;
  const feedback = feedbackQuery.data || [];
  const ratings = (ratingsQuery.data?.items || []) as Array<{ id: string; ticketId: string; agentId: string; supportId: string | null; rating: number; comment: string | null; createdAt: string }>;
  const loadingFeedback = feedbackQuery.isLoading;
  const loadingRatings = ratingsQuery.isLoading;

  const markTreated = async (id: string) => {
    markTreatedMutation.mutate(id);
  };

  const agentDeptMap: Record<string, string> = {};
  const supportNameMap: Record<string, string> = {};
  users.forEach((u) => {
    const userRoles = u.roles || [];
    if (userRoles.includes('agent')) agentDeptMap[u.id] = u.dept || 'N/A';
    if (userRoles.includes('support') || userRoles.includes('admin')) supportNameMap[u.id] = u.name;
  });

  const supportRatings: SupportRatings = {};
  ratings.forEach((r) => {
    const name = supportNameMap[r.supportId || ''] || r.supportId || 'Unknown';
    if (!supportRatings[name]) {
      supportRatings[name] = {
        total: 0,
        sum: 0,
        ratings: [],
        depts: {
          DSC: { total: 0, sum: 0, count5: 0, countLow: 0 },
          FOT: { total: 0, sum: 0, count5: 0, countLow: 0 },
        },
      };
    }
    supportRatings[name].total++;
    supportRatings[name].sum += r.rating;
    supportRatings[name].ratings.push(r);

    const dept = agentDeptMap[r.agentId];
    if (dept && supportRatings[name].depts[dept]) {
      const d = supportRatings[name].depts[dept];
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
        <h2 className="text-xl font-bold">Feedback & Ratings</h2>
        <div className="flex gap-1">
          <button
            onClick={() => setTab('feedback')}
            className={`px-3 py-1.5 text-xs font-medium ${
              tab === 'feedback'
                ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)]'
                : 'bg-bg-elevated text-[var(--color-text-secondary)] hover:opacity-100'
            }`}
          >
            Feedback ({feedback.length})
          </button>
          <button
            onClick={() => setTab('ratings')}
            className={`px-3 py-1.5 text-xs font-medium ${
              tab === 'ratings'
                ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)]'
                : 'bg-bg-elevated text-[var(--color-text-secondary)] hover:opacity-100'
            }`}
          >
            Ratings ({ratings.length})
          </button>
        </div>
      </div>

      {tab === 'feedback' && (
        <div className="space-y-6">
          <div className="space-y-3">
            {loadingFeedback ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-32 w-full" />
                ))}
              </div>
            ) : activeFeedback.length === 0 ? (
              <div className="surface-card p-8 text-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-12 w-12 mx-auto opacity-20 mb-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-[var(--color-text-secondary)] text-sm font-medium">All caught up! No active feedback.</p>
              </div>
            ) : (
              activeFeedback.map((f) => (
                <div
                  key={f.id}
                  className="surface-card p-5"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 border border-[var(--color-border)] flex items-center justify-center text-sm font-bold">
                        {(f.userName || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold">{f.userName}</span>
                          <span className="text-[10px] font-bold uppercase tracking-wide bg-bg-elevated text-[var(--color-text-secondary)] px-2 py-0.5">
                            {f.role}
                          </span>
                        </div>
                        <span className="text-xs text-[var(--color-text-secondary)]">
                          {new Date(f.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => markTreated(f.id)}
                      disabled={markTreatedMutation.isPending}
                      className="btn-secondary disabled:opacity-50"
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
                  <p className="text-[15px] leading-relaxed pl-13">{f.text}</p>
                </div>
              ))
            )}
          </div>

          {dismissedFeedback.length > 0 && (
            <div className="mt-8 border-t border-[var(--color-border)] pt-6">
              <button
                onClick={() => setShowDismissed(!showDismissed)}
                className="w-full flex items-center justify-between text-left p-4 bg-bg-elevated hover:bg-bg-elevated border border-[var(--color-border)]"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold">Dismissed Feedback</span>
                  <span className="bg-bg-elevated text-[var(--color-text-secondary)] text-xs font-semibold px-2.5 py-1">
                    {dismissedFeedback.length}
                  </span>
                </div>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className={`h-5 w-5 text-[var(--color-text-secondary)] ${showDismissed ? 'rotate-180' : ''}`}
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
                <div className="mt-3 space-y-3">
                  {dismissedFeedback.map((f) => (
                    <div
                      key={f.id}
                      className="bg-bg-elevated border border-[var(--color-border)] p-4 opacity-75"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[var(--color-text-secondary)]">{f.userName}</span>
                          <span className="text-[10px] uppercase font-bold text-[var(--color-text-muted)]">{f.role}</span>
                          <span className="text-xs bg-bg-elevated px-2 py-0.5 flex items-center gap-1 font-medium border border-[var(--color-border)]">
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
                        <span className="text-xs text-[var(--color-text-secondary)]">
                          {new Date(f.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                      </div>
                      <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap">{f.text}</p>
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
              <div className="grid grid-cols-4 gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : ratings.length === 0 ? (
            <div className="surface-card p-8 text-center">
              <p className="text-[var(--color-text-secondary)] text-sm">No ratings submitted yet.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-3">
                <div className="surface-card p-4">
                  <p className="text-xs text-[var(--color-text-secondary)]">Total ratings</p>
                  <p className="text-2xl font-bold mt-1">{ratings.length}</p>
                </div>
                <div className="surface-card p-4">
                  <p className="text-xs text-[var(--color-text-secondary)]">Average</p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-2xl font-bold">{(ratings.reduce((s, r) => s + r.rating, 0) / ratings.length).toFixed(1)}</p>
                    <Stars value={Math.round(ratings.reduce((s, r) => s + r.rating, 0) / ratings.length)} />
                  </div>
                </div>
                <div className="surface-card p-4">
                  <p className="text-xs text-[var(--color-text-secondary)]">5-star</p>
                  <p className="text-2xl font-bold mt-1">{ratings.filter((r) => r.rating === 5).length}</p>
                </div>
                <div className="surface-card p-4">
                  <p className="text-xs text-[var(--color-text-secondary)]">1-2 star</p>
                  <p className="text-2xl font-bold mt-1">{ratings.filter((r) => r.rating <= 2).length}</p>
                </div>
              </div>

              <div className="surface-card p-4">
                <p className="text-sm font-semibold mb-3">Distribution</p>
                <div className="space-y-2">
                  {[5, 4, 3, 2, 1].map((star) => {
                    const count = ratings.filter((r) => r.rating === star).length;
                    const pct = ratings.length > 0 ? (count / ratings.length) * 100 : 0;
                    return (
                      <div key={star} className="flex items-center gap-2">
                        <span className="text-xs text-[var(--color-text-secondary)] w-3 text-right">{star}</span>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-3.5 w-3.5 shrink-0"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                        >
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                        <div className="flex-1 h-2 bg-bg-elevated overflow-hidden">
                          <div className="h-full bg-[var(--color-text-primary)]" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-[var(--color-text-secondary)] w-8">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {Object.keys(supportRatings).length > 0 && (
                <div>
                  <div className="flex items-center justify-between gap-4 mt-8 mb-4">
                    <p className="text-lg font-bold">Ratings by Support</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[var(--color-text-secondary)]">View:</span>
                      <select
                        value={selectedSupport}
                        onChange={(e) => setSelectedSupport(e.target.value)}
                        className="input-field text-sm"
                      >
                        <option value="ALL">All Support (Overview)</option>
                        {Object.keys(supportRatings)
                          .sort()
                          .map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  {selectedSupport === 'ALL' ? (
                    <div className="surface-card overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[960px] text-left text-sm border-collapse">
                          <thead>
                            <tr className="bg-bg-elevated border-b border-[var(--color-border)]">
                              <th className="px-6 py-4 font-mono text-[9px] uppercase text-[var(--color-text-muted)]">Support Name</th>
                              <th className="px-6 py-4 font-mono text-[9px] uppercase text-[var(--color-text-muted)] text-center">Avg Rating</th>
                              <th className="px-6 py-4 font-mono text-[9px] uppercase text-[var(--color-text-muted)] text-center">Trend</th>
                              <th className="px-6 py-4 font-mono text-[9px] uppercase text-[var(--color-text-muted)] text-center">Total</th>
                              <th className="px-6 py-4 font-mono text-[9px] uppercase text-[var(--color-text-muted)] text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--color-border)]">
                            {Object.entries(supportRatings)
                              .sort((a, b) => b[1].total - a[1].total)
                              .map(([name, e]) => {
                                const avg = (e.sum / e.total).toFixed(1);
                                return (
                                  <tr key={name} className="hover:bg-bg-elevated">
                                    <td className="px-6 py-4">
                                      <span className="font-bold">{name}</span>
                                    </td>
                                    <td className="px-6 py-4">
                                      <div className="flex items-center justify-center gap-2">
                                        <span className="font-bold">
                                          {avg}
                                        </span>
                                        <Stars value={Math.round(e.sum / e.total)} />
                                      </div>
                                    </td>
                                    <td className="px-6 py-4">
                                      <div className="flex items-center justify-center gap-4 text-xs font-semibold">
                                        <span>5★ ({e.ratings.filter((r) => r.rating === 5).length})</span>
                                        <span className="text-[var(--color-text-secondary)]">1-2★ ({e.ratings.filter((r) => r.rating <= 2).length})</span>
                                      </div>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                      <span className="bg-bg-elevated text-[var(--color-text-secondary)] px-2 py-1 text-xs font-bold">
                                        {e.total}
                                      </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                      <button onClick={() => setSelectedSupport(name)} className="font-bold text-xs underline">
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
                    <div>
                      {(() => {
                        const e = supportRatings[selectedSupport];
                        if (!e) return null;
                        const avg = (e.sum / e.total).toFixed(1);
                        return (
                          <div className="surface-card p-6">
                            <div className="flex items-center justify-between mb-4 border-b border-[var(--color-border)] pb-4">
                              <div className="flex items-center gap-3">
                                <div className="w-12 h-12 border border-[var(--color-border)] flex items-center justify-center text-xl font-bold">
                                  {selectedSupport[0]}
                                </div>
                                <h3 className="font-bold text-xl">{selectedSupport}</h3>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="text-right">
                                  <p className="text-2xl font-bold leading-none">{avg}</p>
                                  <div className="mt-1">
                                    <Stars value={Math.round(e.sum / e.total)} />
                                  </div>
                                </div>
                                <div className="h-10 w-px bg-[var(--color-border)] mx-1" />
                                <div className="bg-bg-elevated px-4 py-2 text-center">
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-secondary)]">Total Ratings</p>
                                  <p className="text-lg font-bold">{e.total}</p>
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-6 mt-6">
                              {/* DSC Breakdown */}
                              <div className="bg-bg-elevated p-5 border border-[var(--color-border)] relative overflow-hidden">
                                <div className="flex justify-between items-center mb-4">
                                  <div>
                                    <span className="text-sm font-bold uppercase tracking-wide">DSC</span>
                                    <p className="text-xs text-[var(--color-text-secondary)]">Customer Support</p>
                                  </div>
                                  <span className="text-xs font-bold bg-bg-elevated px-3 py-1">
                                    {e.depts.DSC.total} ratings
                                  </span>
                                </div>
                                {e.depts.DSC.total > 0 ? (
                                  <div className="space-y-3">
                                    <div className="flex justify-between items-center bg-bg-elevated p-2">
                                      <span className="text-xs font-medium text-[var(--color-text-secondary)]">Average Score</span>
                                      <span className="text-lg font-bold">{(e.depts.DSC.sum / e.depts.DSC.total).toFixed(1)}</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="bg-bg-elevated p-2 text-center border border-[var(--color-border)]">
                                        <span className="block text-[10px] font-bold uppercase">5 Stars</span>
                                        <span className="text-lg font-bold">{e.depts.DSC.count5}</span>
                                      </div>
                                      <div className="bg-bg-elevated p-2 text-center border border-[var(--color-border)]">
                                        <span className="block text-[10px] text-[var(--color-text-secondary)] font-bold uppercase">1-2 Stars</span>
                                        <span className="text-lg font-bold text-[var(--color-text-secondary)]">{e.depts.DSC.countLow}</span>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="py-6 text-center border-2 border-dashed border-[var(--color-border)]">
                                    <p className="text-sm text-[var(--color-text-secondary)]">No DSC ratings</p>
                                  </div>
                                )}
                              </div>

                              {/* FOT Breakdown */}
                              <div className="bg-bg-elevated p-5 border border-[var(--color-border)]">
                                <div className="flex justify-between items-center mb-4">
                                  <div>
                                    <span className="text-sm font-bold uppercase tracking-wide">FOT</span>
                                    <p className="text-xs text-[var(--color-text-secondary)]">Front Office Team</p>
                                  </div>
                                  <span className="text-xs font-bold bg-bg-elevated px-3 py-1">
                                    {e.depts.FOT.total} ratings
                                  </span>
                                </div>
                                {e.depts.FOT.total > 0 ? (
                                  <div className="space-y-3">
                                    <div className="flex justify-between items-center bg-bg-elevated p-2">
                                      <span className="text-xs font-medium text-[var(--color-text-secondary)]">Average Score</span>
                                      <span className="text-lg font-bold">{(e.depts.FOT.sum / e.depts.FOT.total).toFixed(1)}</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="bg-bg-elevated p-2 text-center border border-[var(--color-border)]">
                                        <span className="block text-[10px] font-bold uppercase">5 Stars</span>
                                        <span className="text-lg font-bold">{e.depts.FOT.count5}</span>
                                      </div>
                                      <div className="bg-bg-elevated p-2 text-center border border-[var(--color-border)]">
                                        <span className="block text-[10px] text-[var(--color-text-secondary)] font-bold uppercase">1-2 Stars</span>
                                        <span className="text-lg font-bold text-[var(--color-text-secondary)]">{e.depts.FOT.countLow}</span>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="py-6 text-center border-2 border-dashed border-[var(--color-border)]">
                                    <p className="text-sm text-[var(--color-text-secondary)]">No FOT ratings</p>
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

              <div className="surface-card overflow-hidden">
                <p className="text-sm font-semibold px-4 py-3 border-b border-[var(--color-border)]">
                  Recent ratings
                </p>
                <div className="divide-y divide-[var(--color-border)]">
                  {ratings.slice(0, 50).map((r) => (
                    <div key={r.id} className="px-4 py-3 flex items-start gap-3">
                      <Stars value={r.rating} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 overflow-x-auto">
                          <span className="text-xs text-[var(--color-text-secondary)]">
                            Agent:{' '}
                            <span className="font-medium">
                              {supportNameMap[r.agentId] || r.agentId}
                            </span>
                          </span>
                          {r.supportId && (
                            <span className="text-xs text-[var(--color-text-secondary)]">
                              Support:{' '}
                              <span className="font-medium">
                                {supportNameMap[r.supportId] || r.supportId}
                              </span>
                            </span>
                          )}
                          <span className="text-xs text-[var(--color-text-secondary)]">
                            {new Date(r.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                        </div>
                        {r.comment && <p className="text-sm mt-1">{r.comment}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedSupport !== 'ALL' && (
                <div className="mt-6 flex justify-center">
                  <button
                    onClick={() => setSelectedSupport('ALL')}
                    className="text-xs font-bold text-[var(--color-text-secondary)] hover:opacity-100 flex items-center gap-2"
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

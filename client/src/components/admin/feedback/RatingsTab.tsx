import { useState, useMemo } from 'react';
import { Stars, Skeleton } from '../DashboardHelpers';
import { trpc } from '../../../utils/trpc';
import { usePartner } from '../../../hooks/usePartner';
import { aggregateSupportRatings, buildUserMaps, RatingInput, UserInput, DeptBreakdown as DeptBreakdownData } from './supportRatings';

export default function RatingsTab() {
  const [selectedSupport, setSelectedSupport] = useState('ALL');
  const { manifest } = usePartner();
  const departments = useMemo(() => manifest.departments || [], [manifest.departments]);
  const deptIdKey = departments.map((d) => d.id).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const deptIds = useMemo(() => departments.map((d) => d.id), [deptIdKey]);

  const ratingsQuery = trpc.rating.list.useQuery({ limit: 200 });
  const { data: usersData } = trpc.user.list.useQuery();

  const users: UserInput[] = usersData?.users ?? [];
  const ratings = (ratingsQuery.data?.items || []) as RatingInput[];
  const loading = ratingsQuery.isLoading;

  const maps = useMemo(() => buildUserMaps(users), [users]);
  const supportRatings = useMemo(
    () => aggregateSupportRatings(ratings, maps, deptIds),
    [ratings, maps, deptIds],
  );
  const { supportNameMap } = maps;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (ratingsQuery.error) {
    return (
      <div className="surface-card p-8 text-center">
        <p className="text-xs uppercase font-bold text-[var(--color-accent-red)]">Failed to load ratings</p>
        <p className="text-[10px] font-mono text-[var(--color-text-muted)] mt-2">{ratingsQuery.error.message}</p>
      </div>
    );
  }

  if (ratings.length === 0) {
    return (
      <div className="surface-card p-8 text-center">
        <p className="text-[var(--color-text-secondary)] text-sm">No ratings submitted yet.</p>
      </div>
    );
  }

  const total = ratings.length;
  const avg = ratings.reduce((s, r) => s + r.rating, 0) / total;
  const fiveStar = ratings.filter((r) => r.rating === 5).length;
  const lowStar = ratings.filter((r) => r.rating <= 2).length;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="surface-card p-4">
          <p className="text-xs text-[var(--color-text-secondary)]">Total ratings</p>
          <p className="text-2xl font-bold mt-1">{total}</p>
        </div>
        <div className="surface-card p-4">
          <p className="text-xs text-[var(--color-text-secondary)]">Average</p>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-2xl font-bold">{avg.toFixed(1)}</p>
            <Stars value={Math.round(avg)} />
          </div>
        </div>
        <div className="surface-card p-4">
          <p className="text-xs text-[var(--color-text-secondary)]">5-star</p>
          <p className="text-2xl font-bold mt-1">{fiveStar}</p>
        </div>
        <div className="surface-card p-4">
          <p className="text-xs text-[var(--color-text-secondary)]">1-2 star</p>
          <p className="text-2xl font-bold mt-1">{lowStar}</p>
        </div>
      </div>

      {/* Distribution */}
      <div className="surface-card p-4">
        <p className="text-sm font-semibold mb-3">Distribution</p>
        <div className="space-y-2">
          {[5, 4, 3, 2, 1].map((star) => {
            const count = ratings.filter((r) => r.rating === star).length;
            const pct = total > 0 ? (count / total) * 100 : 0;
            return (
              <div key={star} className="flex items-center gap-2">
                <span className="text-xs text-[var(--color-text-secondary)] w-3 text-right">{star}</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
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

      {/* Ratings by Support */}
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
                {Object.keys(supportRatings).sort().map((name) => (
                  <option key={name} value={name}>{name}</option>
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
                        const supportAvg = (e.sum / e.total).toFixed(1);
                        return (
                          <tr key={name} className="hover:bg-bg-elevated">
                            <td className="px-6 py-4">
                              <span className="font-bold">{name}</span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center justify-center gap-2">
                                <span className="font-bold">{supportAvg}</span>
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
                              <span className="bg-bg-elevated text-[var(--color-text-secondary)] px-2 py-1 text-xs font-bold">{e.total}</span>
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
            <SupportDetail
              name={selectedSupport}
              entry={supportRatings[selectedSupport]}
              departments={departments}
              onBack={() => setSelectedSupport('ALL')}
            />
          )}
        </div>
      )}

      {/* Recent ratings */}
      <div className="surface-card overflow-hidden">
        <p className="text-sm font-semibold px-4 py-3 border-b border-[var(--color-border)]">Recent ratings</p>
        <div className="divide-y divide-[var(--color-border)]">
          {ratings.slice(0, 50).map((r) => (
            <div key={r.id} className="px-4 py-3 flex items-start gap-3">
              <Stars value={r.rating} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 overflow-x-auto">
                  <span className="text-xs text-[var(--color-text-secondary)]">
                    Agent: <span className="font-medium">{supportNameMap[r.agentId] || r.agentId}</span>
                  </span>
                  {r.supportId && (
                    <span className="text-xs text-[var(--color-text-secondary)]">
                      Support: <span className="font-medium">{supportNameMap[r.supportId] || r.supportId}</span>
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
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Overview
          </button>
        </div>
      )}
    </div>
  );
}

interface DeptInfo {
  id: string;
  name: string;
  description?: string;
}

function SupportDetail({
  name,
  entry,
  departments,
  onBack: _onBack,
}: {
  name: string;
  entry: ReturnType<typeof aggregateSupportRatings>[string] | undefined;
  departments: DeptInfo[];
  onBack: () => void;
}) {
  if (!entry) return null;
  const hasRatings = entry.total > 0;
  const avg = hasRatings ? (entry.sum / entry.total).toFixed(1) : '—';

  // Responsive grid: 1 column on narrow, 2+ on medium+ — handles any dept count.
  const gridCols = departments.length <= 1
    ? 'grid-cols-1'
    : departments.length === 2
      ? 'grid-cols-1 md:grid-cols-2'
      : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';

  return (
    <div className="surface-card p-6">
      <div className="flex items-center justify-between mb-4 border-b border-[var(--color-border)] pb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 border border-[var(--color-border)] flex items-center justify-center text-xl font-bold">
            {name[0]}
          </div>
          <h3 className="font-bold text-xl">{name}</h3>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-2xl font-bold leading-none">{avg}</p>
            <div className="mt-1">
              <Stars value={hasRatings ? Math.round(entry.sum / entry.total) : 0} />
            </div>
          </div>
          <div className="h-10 w-px bg-[var(--color-border)] mx-1" />
          <div className="bg-bg-elevated px-4 py-2 text-center">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-secondary)]">Total Ratings</p>
            <p className="text-lg font-bold">{entry.total}</p>
          </div>
        </div>
      </div>
      {departments.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)] mt-6 py-6 text-center border-2 border-dashed border-[var(--color-border)]">
          No departments configured for this partner
        </p>
      ) : (
        <div className={`grid gap-6 mt-6 ${gridCols}`}>
          {departments.map((dept) => (
            <DeptBreakdownCard
              key={dept.id}
              deptId={dept.id}
              deptName={dept.name}
              description={dept.description}
              data={entry.depts[dept.id] ?? { total: 0, sum: 0, count5: 0, countLow: 0 }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DeptBreakdownCard({
  deptId,
  deptName,
  description,
  data,
}: {
  deptId: string;
  deptName: string;
  description?: string;
  data: DeptBreakdownData;
}) {
  return (
    <div className="bg-bg-elevated p-5 border border-[var(--color-border)] relative overflow-hidden">
      <div className="flex justify-between items-center mb-4">
        <div>
          <span className="text-sm font-bold uppercase tracking-wide">{deptName}</span>
          {description && <p className="text-xs text-[var(--color-text-secondary)]">{description}</p>}
        </div>
        <span className="text-xs font-bold bg-bg-elevated px-3 py-1">{data.total} ratings</span>
      </div>
      {data.total > 0 ? (
        <div className="space-y-3">
          <div className="flex justify-between items-center bg-bg-elevated p-2">
            <span className="text-xs font-medium text-[var(--color-text-secondary)]">Average Score</span>
            <span className="text-lg font-bold">{(data.sum / data.total).toFixed(1)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-bg-elevated p-2 text-center border border-[var(--color-border)]">
              <span className="block text-[10px] font-bold uppercase">5 Stars</span>
              <span className="text-lg font-bold">{data.count5}</span>
            </div>
            <div className="bg-bg-elevated p-2 text-center border border-[var(--color-border)]">
              <span className="block text-[10px] text-[var(--color-text-secondary)] font-bold uppercase">1-2 Stars</span>
              <span className="text-lg font-bold text-[var(--color-text-secondary)]">{data.countLow}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="py-6 text-center border-2 border-dashed border-[var(--color-border)]">
          <p className="text-sm text-[var(--color-text-secondary)]">No {deptId} ratings</p>
        </div>
      )}
    </div>
  );
}

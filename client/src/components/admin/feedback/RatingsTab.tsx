import { useState, useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Stars, Skeleton } from '../DashboardHelpers';
import Avatar from '../../ui/Avatar';
import { trpc } from '../../../utils/trpc';
import { usePartner } from '../../../hooks/usePartner';
import { aggregateSupportRatings, buildUserMaps, RatingInput, UserInput, DeptBreakdown as DeptBreakdownData } from './supportRatings';

const CARD = 'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)]';
const COL_HEAD = 'px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]';

export default function RatingsTab() {
  const [selectedSupport, setSelectedSupport] = useState('ALL');
  const { manifest } = usePartner();
  const departments = useMemo(() => manifest.departments || [], [manifest.departments]);
  const deptIdKey = departments.map((d) => d.id).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const deptIds = useMemo(() => departments.map((d) => d.id), [deptIdKey]);

  const ratingsQuery = trpc.rating.list.useQuery({ limit: 200 });
  const { data: usersData } = trpc.user.list.useQuery();

  const users: UserInput[] = useMemo(() => usersData?.users ?? [], [usersData?.users]);
  const ratings = useMemo(() => (ratingsQuery.data?.items || []) as RatingInput[], [ratingsQuery.data?.items]);
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
      <div className={`${CARD} p-8 text-center`}>
        <p className="text-[13px] font-medium text-[var(--color-urgent)]">Failed to load ratings</p>
        <p className="text-[12px] text-[var(--color-ink-muted)] mt-2">{ratingsQuery.error.message}</p>
      </div>
    );
  }

  if (ratings.length === 0) {
    return (
      <div className={`${CARD} p-10 text-center`}>
        <p className="text-[var(--color-ink-soft)] text-[13px]">No ratings submitted yet.</p>
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={`${CARD} p-4`}>
          <p className="text-[12px] text-[var(--color-ink-muted)]">Total ratings</p>
          <p className="text-[24px] font-semibold mt-1 text-[var(--color-ink)]">{total}</p>
        </div>
        <div className={`${CARD} p-4`}>
          <p className="text-[12px] text-[var(--color-ink-muted)]">Average</p>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-[24px] font-semibold text-[var(--color-ink)]">{avg.toFixed(1)}</p>
            <Stars value={Math.round(avg)} />
          </div>
        </div>
        <div className={`${CARD} p-4`}>
          <p className="text-[12px] text-[var(--color-ink-muted)]">5-star</p>
          <p className="text-[24px] font-semibold mt-1 text-[var(--color-ok)]">{fiveStar}</p>
        </div>
        <div className={`${CARD} p-4`}>
          <p className="text-[12px] text-[var(--color-ink-muted)]">1-2 star</p>
          <p className="text-[24px] font-semibold mt-1 text-[var(--color-urgent)]">{lowStar}</p>
        </div>
      </div>

      {/* Distribution */}
      <div className={`${CARD} p-5`}>
        <p className="text-[13px] font-semibold mb-3 text-[var(--color-ink)]">Distribution</p>
        <div className="space-y-2">
          {[5, 4, 3, 2, 1].map((star) => {
            const count = ratings.filter((r) => r.rating === star).length;
            const pct = total > 0 ? (count / total) * 100 : 0;
            return (
              <div key={star} className="flex items-center gap-2">
                <span className="text-[12px] text-[var(--color-ink-muted)] w-3 text-right tabular-nums">{star}</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-muted)]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                <div className="flex-1 h-2 bg-[var(--color-bg-elevated)] overflow-hidden rounded-[var(--radius-pill)]">
                  <div className="h-full bg-[var(--color-accent)]" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[12px] text-[var(--color-ink-muted)] w-8 tabular-nums">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Ratings by Support */}
      {Object.keys(supportRatings).length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-4 mt-8 mb-4">
            <p className="text-[16px] font-semibold text-[var(--color-ink)]">Ratings by Support</p>
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium text-[var(--color-ink-muted)]">View</span>
              <select
                value={selectedSupport}
                onChange={(e) => setSelectedSupport(e.target.value)}
                className="h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none"
              >
                <option value="ALL">All Support (Overview)</option>
                {Object.keys(supportRatings).sort().map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          </div>

          {selectedSupport === 'ALL' ? (
            <div className={`${CARD} overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] text-left text-[13px] border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--color-border)]">
                      <th className={COL_HEAD}>Support Name</th>
                      <th className={`${COL_HEAD} text-center`}>Avg Rating</th>
                      <th className={`${COL_HEAD} text-center`}>Trend</th>
                      <th className={`${COL_HEAD} text-center`}>Total</th>
                      <th className={`${COL_HEAD} text-right`}>Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {Object.entries(supportRatings)
                      .sort((a, b) => b[1].total - a[1].total)
                      .map(([name, e]) => {
                        const supportAvg = (e.sum / e.total).toFixed(1);
                        return (
                          <tr key={name} className="hover:bg-[var(--color-hover)]">
                            <td className="px-6 py-4">
                              <span className="font-semibold text-[var(--color-ink)]">{name}</span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center justify-center gap-2">
                                <span className="font-semibold text-[var(--color-ink)]">{supportAvg}</span>
                                <Stars value={Math.round(e.sum / e.total)} />
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center justify-center gap-4 text-[12px] font-medium">
                                <span className="text-[var(--color-ok)]">5★ ({e.ratings.filter((r) => r.rating === 5).length})</span>
                                <span className="text-[var(--color-urgent)]">1-2★ ({e.ratings.filter((r) => r.rating <= 2).length})</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className="bg-[var(--color-bg-elevated)] text-[var(--color-ink-soft)] px-2.5 py-0.5 rounded-[var(--radius-pill)] text-[12px] font-semibold tabular-nums">{e.total}</span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button
                                onClick={() => setSelectedSupport(name)}
                                className="text-[13px] font-medium text-[var(--color-accent)] hover:underline"
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
      <div className={`${CARD} overflow-hidden`}>
        <p className="text-[13px] font-semibold px-5 py-3 border-b border-[var(--color-border)] text-[var(--color-ink)]">Recent ratings</p>
        <div className="divide-y divide-[var(--color-border)]">
          {ratings.slice(0, 50).map((r) => (
            <div key={r.id} className="px-5 py-3 flex items-start gap-3">
              <Stars value={r.rating} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 overflow-x-auto text-[12px] text-[var(--color-ink-muted)]">
                  <span>
                    Agent <span className="font-medium text-[var(--color-ink-soft)]">{supportNameMap[r.agentId] || r.agentId}</span>
                  </span>
                  {r.supportId && (
                    <span>
                      Support <span className="font-medium text-[var(--color-ink-soft)]">{supportNameMap[r.supportId] || r.supportId}</span>
                    </span>
                  )}
                  <span>
                    {new Date(r.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>
                {r.comment && <p className="text-[14px] mt-1 text-[var(--color-ink)]">{r.comment}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedSupport !== 'ALL' && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => setSelectedSupport('ALL')}
            className="inline-flex items-center gap-2 text-[13px] font-medium text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
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

  const gridCols = departments.length <= 1
    ? 'grid-cols-1'
    : departments.length === 2
      ? 'grid-cols-1 md:grid-cols-2'
      : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';

  return (
    <div className={`${CARD} p-6`}>
      <div className="flex items-center justify-between mb-4 border-b border-[var(--color-border)] pb-4 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Avatar name={name} size={48} />
          <h3 className="font-semibold text-[18px] text-[var(--color-ink)]">{name}</h3>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-[24px] font-semibold leading-none text-[var(--color-ink)]">{avg}</p>
            <div className="mt-1">
              <Stars value={hasRatings ? Math.round(entry.sum / entry.total) : 0} />
            </div>
          </div>
          <div className="h-10 w-px bg-[var(--color-border)] mx-1" />
          <div className="bg-[var(--color-bg-elevated)] rounded-[var(--radius-card)] px-4 py-2 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">Total Ratings</p>
            <p className="text-[18px] font-semibold text-[var(--color-ink)]">{entry.total}</p>
          </div>
        </div>
      </div>
      {departments.length === 0 ? (
        <p className="text-[13px] text-[var(--color-ink-muted)] mt-6 py-6 text-center rounded-[var(--radius-card)] border-2 border-dashed border-[var(--color-border)]">
          No departments configured for this partner
        </p>
      ) : (
        <div className={`grid gap-4 mt-6 ${gridCols}`}>
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
    <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] p-5">
      <div className="flex justify-between items-start mb-4 gap-3">
        <div className="min-w-0">
          <span className="text-[13px] font-semibold text-[var(--color-ink)]">{deptName}</span>
          {description && <p className="text-[12px] text-[var(--color-ink-muted)] mt-0.5 truncate">{description}</p>}
        </div>
        <span className="shrink-0 text-[11px] font-medium bg-[var(--color-bg-surface)] text-[var(--color-ink-soft)] px-2 py-0.5 rounded-[var(--radius-pill)] tabular-nums">{data.total} ratings</span>
      </div>
      {data.total > 0 ? (
        <div className="space-y-2.5">
          <div className="flex justify-between items-center bg-[var(--color-bg-surface)] px-3 py-2 rounded-[var(--radius-btn)]">
            <span className="text-[12px] font-medium text-[var(--color-ink-muted)]">Average Score</span>
            <span className="text-[16px] font-semibold text-[var(--color-ink)]">{(data.sum / data.total).toFixed(1)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[var(--color-bg-surface)] px-3 py-2 rounded-[var(--radius-btn)] text-center">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">5 Stars</span>
              <span className="text-[16px] font-semibold text-[var(--color-ok)]">{data.count5}</span>
            </div>
            <div className="bg-[var(--color-bg-surface)] px-3 py-2 rounded-[var(--radius-btn)] text-center">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">1-2 Stars</span>
              <span className="text-[16px] font-semibold text-[var(--color-urgent)]">{data.countLow}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="py-5 text-center rounded-[var(--radius-btn)] border-2 border-dashed border-[var(--color-border)]">
          <p className="text-[12px] text-[var(--color-ink-muted)]">No {deptId} ratings</p>
        </div>
      )}
    </div>
  );
}

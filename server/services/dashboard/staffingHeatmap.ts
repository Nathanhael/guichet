/**
 * Dashboard Z3 — Staffing-fit deep service (tracer-bullet: matrix only).
 *
 * Pure transform. Folds per-day hourly counts into:
 *   1. `heatmap`      — dow×hour cells, averaged across the weeks observed
 *                       in the window. Only cells with at least one
 *                       observation are emitted (UI fills the rest visually).
 *   2. `todayVsTypical` — 24-slot strip comparing today's hourly counts with
 *                       the same-weekday average over the rest of the window.
 *   3. `daysCollected`  — how many in-window days the caller fed in. The UI
 *                       uses this to render the "Need 7+ days of data" warm-
 *                       up state from spec §7.
 *
 * No DB calls — fixture-testable. Caller provides already-filtered rows.
 * Staff-count overlay arrives in the second slice once shape is proven.
 *
 * Day-of-week convention: JS `Date#getUTCDay()` (0 = Sunday … 6 = Saturday).
 */

export interface DailyStatsRow {
  date: string;
  hourly: number[];
}

export interface AgentStatusRow {
  date: string;
  userId: string;
  onlineSeconds: number;
}

export interface StaffingHeatmapInput {
  dailyStats: DailyStatsRow[];
  agentStatus?: AgentStatusRow[];
  window: { from: Date; to: Date };
  now?: Date;
  excludeWeekends?: boolean;
}

export interface HeatmapCell {
  hour: number;
  dow: number;
  tickets: number;
  staff?: number;
}

export interface HourArrival {
  hour: number;
  todayCount: number;
  typicalCount: number;
}

export interface StaffingHeatmap {
  heatmap: HeatmapCell[];
  todayVsTypical: HourArrival[];
  daysCollected: number;
}

const HOURS = 24;
const WEEKEND_DOWS = new Set([0, 6]);

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function dowFor(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

function dateInWindow(dateStr: string, from: Date, to: Date): boolean {
  const t = new Date(`${dateStr}T00:00:00Z`).getTime();
  return t >= from.getTime() && t <= to.getTime();
}

export function buildStaffingHeatmap(input: StaffingHeatmapInput): StaffingHeatmap {
  const now = input.now ?? new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const todayDow = now.getUTCDay();

  const inWindow = input.dailyStats.filter((row) =>
    dateInWindow(row.date, input.window.from, input.window.to),
  );

  const includeRow = (row: DailyStatsRow): boolean =>
    !input.excludeWeekends || !WEEKEND_DOWS.has(dowFor(row.date));

  const filtered = inWindow.filter(includeRow);

  // Aggregate cell sums + occurrence counts per (dow, hour).
  const cellSum = new Map<string, number>();
  const cellCount = new Map<string, number>();
  const key = (dow: number, hour: number) => `${dow}:${hour}`;

  for (const row of filtered) {
    const dow = dowFor(row.date);
    for (let hour = 0; hour < HOURS; hour++) {
      const k = key(dow, hour);
      cellCount.set(k, (cellCount.get(k) ?? 0) + 1);
      cellSum.set(k, (cellSum.get(k) ?? 0) + (row.hourly[hour] ?? 0));
    }
  }

  // Staff overlay (Z3b) — per-dow average distinct online users across the
  // 28-day window. Daily granularity from `daily_agent_status`; we apply the
  // same per-dow figure to every hour of that dow because the rollup table
  // doesn't carry hourly resolution. When agentStatus rows are provided, we
  // also surface cells for hours with zero tickets so admins can spot
  // over-staffing on quiet hours.
  const filteredAgents = (input.agentStatus ?? []).filter(
    (r) =>
      r.onlineSeconds > 0 &&
      dateInWindow(r.date, input.window.from, input.window.to) &&
      (!input.excludeWeekends || !WEEKEND_DOWS.has(dowFor(r.date))),
  );
  const usersPerDate = new Map<string, Set<string>>();
  for (const r of filteredAgents) {
    let set = usersPerDate.get(r.date);
    if (!set) {
      set = new Set();
      usersPerDate.set(r.date, set);
    }
    set.add(r.userId);
  }
  const staffSumByDow = new Map<number, number>();
  const staffCountByDow = new Map<number, number>();
  for (const [date, users] of usersPerDate.entries()) {
    const dow = dowFor(date);
    staffSumByDow.set(dow, (staffSumByDow.get(dow) ?? 0) + users.size);
    staffCountByDow.set(dow, (staffCountByDow.get(dow) ?? 0) + 1);
  }
  const staffByDow = new Map<number, number>();
  for (const [dow, sum] of staffSumByDow.entries()) {
    staffByDow.set(dow, round1(sum / staffCountByDow.get(dow)!));
  }

  const heatmap: HeatmapCell[] = [];
  const emitted = new Set<string>();
  for (const [k, sum] of cellSum.entries()) {
    if (sum === 0) continue;
    const count = cellCount.get(k)!;
    const [dowStr, hourStr] = k.split(':');
    const dow = Number(dowStr);
    const hour = Number(hourStr);
    const cell: HeatmapCell = { dow, hour, tickets: round1(sum / count) };
    const staff = staffByDow.get(dow);
    if (staff !== undefined) cell.staff = staff;
    heatmap.push(cell);
    emitted.add(k);
  }
  // For each dow with staff data, ensure all 24 hours surface — staff overlay
  // is useful even where ticket volume is zero.
  for (const [dow, staff] of staffByDow.entries()) {
    for (let hour = 0; hour < HOURS; hour++) {
      const k = `${dow}:${hour}`;
      if (emitted.has(k)) continue;
      heatmap.push({ dow, hour, tickets: 0, staff });
    }
  }
  heatmap.sort((a, b) => (a.dow - b.dow) || (a.hour - b.hour));

  // todayVsTypical: 24 slots. typicalCount averages same-weekday rows in the
  // window EXCLUDING today; todayCount comes from today's row if present.
  const todayRow = filtered.find((r) => r.date === todayStr);
  const sameWeekdayOthers = filtered.filter(
    (r) => r.date !== todayStr && dowFor(r.date) === todayDow,
  );

  const todayVsTypical: HourArrival[] = [];
  for (let hour = 0; hour < HOURS; hour++) {
    const todayCount = todayRow?.hourly[hour] ?? 0;
    const typicalCount = sameWeekdayOthers.length
      ? round1(
          sameWeekdayOthers.reduce(
            (sum, r) => sum + (r.hourly[hour] ?? 0),
            0,
          ) / sameWeekdayOthers.length,
        )
      : 0;
    todayVsTypical.push({ hour, todayCount, typicalCount });
  }

  return {
    heatmap,
    todayVsTypical,
    daysCollected: filtered.length,
  };
}

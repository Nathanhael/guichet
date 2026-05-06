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
  /**
   * 24-element array: seconds the user spent online during each hour-of-day
   * bucket (UTC). Sum equals onlineSeconds. When omitted (legacy rows) the
   * deep service falls back to broadcasting the daily total across all 24
   * hours, preserving the pre-migration behavior.
   */
  hourlyOnlineSeconds?: number[];
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

  // Staff overlay (Z3b) — per-(dow, hour) average distinct online users across
  // the window. Modern rows carry `hourlyOnlineSeconds` (24-element array) so
  // we count "users online in hour H of weekday D" precisely; legacy rows
  // without the array fall back to broadcasting the daily total across all
  // 24 hours so the dashboard keeps rendering during the migration window.
  const filteredAgents = (input.agentStatus ?? []).filter(
    (r) =>
      r.onlineSeconds > 0 &&
      dateInWindow(r.date, input.window.from, input.window.to) &&
      (!input.excludeWeekends || !WEEKEND_DOWS.has(dowFor(r.date))),
  );

  // For each (dow, hour) cell: collect the set of distinct users online
  // per date, then average across the dates with that dow.
  const usersPerDateHour = new Map<string, Map<number, Set<string>>>();
  const datesByDow = new Map<number, Set<string>>();
  for (const r of filteredAgents) {
    const dow = dowFor(r.date);
    let dowDates = datesByDow.get(dow);
    if (!dowDates) {
      dowDates = new Set();
      datesByDow.set(dow, dowDates);
    }
    dowDates.add(r.date);

    let perHour = usersPerDateHour.get(r.date);
    if (!perHour) {
      perHour = new Map();
      usersPerDateHour.set(r.date, perHour);
    }

    const hourly = r.hourlyOnlineSeconds;
    if (Array.isArray(hourly) && hourly.length === HOURS) {
      // Precise per-hour attribution.
      for (let hour = 0; hour < HOURS; hour++) {
        if ((hourly[hour] ?? 0) <= 0) continue;
        let set = perHour.get(hour);
        if (!set) {
          set = new Set();
          perHour.set(hour, set);
        }
        set.add(r.userId);
      }
    } else {
      // Legacy fallback: broadcast user across all 24 hours of this date.
      for (let hour = 0; hour < HOURS; hour++) {
        let set = perHour.get(hour);
        if (!set) {
          set = new Set();
          perHour.set(hour, set);
        }
        set.add(r.userId);
      }
    }
  }

  // Aggregate (dow, hour) -> sum of distinct users / count of dates with that dow.
  const staffSumByCell = new Map<string, number>();
  for (const [date, perHour] of usersPerDateHour.entries()) {
    const dow = dowFor(date);
    for (let hour = 0; hour < HOURS; hour++) {
      const set = perHour.get(hour);
      if (!set || set.size === 0) continue;
      const k = key(dow, hour);
      staffSumByCell.set(k, (staffSumByCell.get(k) ?? 0) + set.size);
    }
  }
  const staffByCell = new Map<string, number>();
  for (const [k, sum] of staffSumByCell.entries()) {
    const [dowStr] = k.split(':');
    const dow = Number(dowStr);
    const dateCount = datesByDow.get(dow)?.size ?? 1;
    staffByCell.set(k, round1(sum / dateCount));
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
    const staff = staffByCell.get(k);
    if (staff !== undefined) cell.staff = staff;
    heatmap.push(cell);
    emitted.add(k);
  }
  // For each dow with staff data, ensure all 24 hours surface — staff overlay
  // is useful even where ticket volume is zero. Cells with no staff in that
  // hour now report `staff: 0` honestly instead of a broadcast daily figure.
  for (const dow of datesByDow.keys()) {
    for (let hour = 0; hour < HOURS; hour++) {
      const k = `${dow}:${hour}`;
      if (emitted.has(k)) continue;
      const staff = staffByCell.get(k) ?? 0;
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

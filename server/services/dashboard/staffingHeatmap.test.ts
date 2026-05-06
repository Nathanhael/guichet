import { describe, it, expect } from 'vitest';
import {
  buildStaffingHeatmap,
  type AgentStatusRow,
  type DailyStatsRow,
  type StaffingHeatmapInput,
} from './staffingHeatmap';

const NOW = new Date('2026-04-25T14:30:00Z'); // Saturday

function zeros24(): number[] {
  return Array.from({ length: 24 }, () => 0);
}

function dayWithHour(date: string, hour: number, count: number): DailyStatsRow {
  const hourly = zeros24();
  hourly[hour] = count;
  return { date, hourly };
}

function input(over: Partial<StaffingHeatmapInput> = {}): StaffingHeatmapInput {
  return {
    dailyStats: [],
    window: {
      from: new Date('2026-03-29T00:00:00Z'),
      to: new Date('2026-04-25T23:59:59Z'),
    },
    now: NOW,
    excludeWeekends: false,
    ...over,
  };
}

describe('buildStaffingHeatmap', () => {
  it('returns an empty heatmap, 24-hour zero strip, and zero daysCollected on empty input', () => {
    const out = buildStaffingHeatmap(input());
    expect(out.heatmap).toEqual([]);
    expect(out.daysCollected).toBe(0);
    expect(out.todayVsTypical).toHaveLength(24);
    for (const slot of out.todayVsTypical) {
      expect(slot.todayCount).toBe(0);
      expect(slot.typicalCount).toBe(0);
    }
  });

  it('counts daysCollected as the number of in-window dailyStats rows', () => {
    const out = buildStaffingHeatmap(
      input({
        dailyStats: [
          dayWithHour('2026-04-19', 9, 3),
          dayWithHour('2026-04-20', 10, 5),
          dayWithHour('2026-04-21', 11, 1),
        ],
      }),
    );
    expect(out.daysCollected).toBe(3);
  });

  it('drops dailyStats rows outside the window', () => {
    const out = buildStaffingHeatmap(
      input({
        dailyStats: [
          dayWithHour('2026-04-25', 9, 5), // in window
          dayWithHour('2026-01-01', 9, 99), // out of window
        ],
      }),
    );
    expect(out.daysCollected).toBe(1);
  });

  it('emits a single cell with the observed count when one day is supplied', () => {
    const out = buildStaffingHeatmap(
      input({
        dailyStats: [dayWithHour('2026-04-21', 9, 4)], // Tuesday
      }),
    );
    const tuesday9 = out.heatmap.find((c) => c.dow === 2 && c.hour === 9);
    expect(tuesday9?.tickets).toBe(4);
  });

  it('averages cell counts across multiple weeks of the same dow+hour', () => {
    // Three Tuesdays, hour 9: counts 4, 6, 8 -> avg 6
    const out = buildStaffingHeatmap(
      input({
        dailyStats: [
          dayWithHour('2026-04-07', 9, 4),
          dayWithHour('2026-04-14', 9, 6),
          dayWithHour('2026-04-21', 9, 8),
        ],
      }),
    );
    const tuesday9 = out.heatmap.find((c) => c.dow === 2 && c.hour === 9);
    expect(tuesday9?.tickets).toBe(6);
  });

  it('emits today-vs-typical with todayCount from today and typicalCount from same-weekday avg', () => {
    // Today (NOW) is Saturday 2026-04-25, dow=6. Three Saturdays in window: 04-04, 04-11, 04-18, 04-25
    const out = buildStaffingHeatmap(
      input({
        dailyStats: [
          dayWithHour('2026-04-04', 14, 2), // Saturday hour 14: 2
          dayWithHour('2026-04-11', 14, 4), // Saturday hour 14: 4
          dayWithHour('2026-04-18', 14, 6), // Saturday hour 14: 6
          dayWithHour('2026-04-25', 14, 10), // today (Saturday) hour 14: 10
        ],
      }),
    );
    const slot = out.todayVsTypical.find((s) => s.hour === 14)!;
    expect(slot.todayCount).toBe(10);
    expect(slot.typicalCount).toBe(4); // avg of 2/4/6 (excluding today)
  });

  it('today-vs-typical reports 0 todayCount when today has no row', () => {
    const out = buildStaffingHeatmap(
      input({
        dailyStats: [
          dayWithHour('2026-04-18', 9, 5),
          dayWithHour('2026-04-11', 9, 7),
        ],
      }),
    );
    const slot = out.todayVsTypical.find((s) => s.hour === 9)!;
    expect(slot.todayCount).toBe(0);
    expect(slot.typicalCount).toBe(6);
  });

  it('excludeWeekends drops Saturdays and Sundays from the heatmap', () => {
    const out = buildStaffingHeatmap(
      input({
        excludeWeekends: true,
        dailyStats: [
          dayWithHour('2026-04-21', 9, 5), // Tuesday (kept)
          dayWithHour('2026-04-25', 9, 9), // Saturday (dropped)
          dayWithHour('2026-04-19', 9, 3), // Sunday (dropped)
        ],
      }),
    );
    expect(out.heatmap.find((c) => c.dow === 0)).toBeUndefined();
    expect(out.heatmap.find((c) => c.dow === 6)).toBeUndefined();
    expect(out.heatmap.find((c) => c.dow === 2 && c.hour === 9)?.tickets).toBe(5);
  });

  it('rounds non-integer averages to one decimal', () => {
    // Two Tuesdays at hour 9: 1 and 4 -> avg 2.5
    const out = buildStaffingHeatmap(
      input({
        dailyStats: [
          dayWithHour('2026-04-14', 9, 1),
          dayWithHour('2026-04-21', 9, 4),
        ],
      }),
    );
    const tuesday9 = out.heatmap.find((c) => c.dow === 2 && c.hour === 9);
    expect(tuesday9?.tickets).toBe(2.5);
  });

  it('warm-up signal: returns daysCollected < 7 when fewer than 7 days are present', () => {
    const out = buildStaffingHeatmap(
      input({
        dailyStats: [
          dayWithHour('2026-04-19', 9, 1),
          dayWithHour('2026-04-20', 9, 1),
        ],
      }),
    );
    expect(out.daysCollected).toBe(2);
  });

  it('omits cells with zero observations (no all-zero noise in the matrix)', () => {
    const out = buildStaffingHeatmap(
      input({
        dailyStats: [dayWithHour('2026-04-21', 9, 5)],
      }),
    );
    // Only one cell observed; all other (dow, hour) combos absent
    expect(out.heatmap).toHaveLength(1);
  });
});

describe('buildStaffingHeatmap — staff overlay (hourly resolution)', () => {
  // Hourly seconds where the user is online for ONE hour at `hour`.
  function hourly(hour: number, seconds = 3600): number[] {
    const arr = Array.from({ length: 24 }, () => 0);
    arr[hour] = seconds;
    return arr;
  }
  // Hourly seconds covering an inclusive range [from, to].
  function hourlyRange(from: number, to: number, secondsPerHour = 3600): number[] {
    const arr = Array.from({ length: 24 }, () => 0);
    for (let h = from; h <= to; h++) arr[h] = secondsPerHour;
    return arr;
  }
  const agent = (
    date: string,
    userId: string,
    hourlyArr: number[],
  ): AgentStatusRow => ({
    date,
    userId,
    onlineSeconds: hourlyArr.reduce((s, n) => s + n, 0),
    hourlyOnlineSeconds: hourlyArr,
  });

  it('leaves cell.staff undefined when no agentStatus rows are supplied', () => {
    const out = buildStaffingHeatmap(
      input({
        dailyStats: [dayWithHour('2026-04-21', 9, 4)],
      }),
    );
    expect(out.heatmap[0].staff).toBeUndefined();
  });

  it('counts staff per (dow, hour) only when the user was online that hour', () => {
    // Tuesday 04-21:
    //   u-a online 9-12  -> contributes to hours 9, 10, 11, 12
    //   u-b online 13-15 -> contributes to hours 13, 14, 15
    // Cell (dow=2, hour=9) sees 1 user, cell (2, 13) sees 1 user, etc.
    const out = buildStaffingHeatmap(
      input({
        dailyStats: [dayWithHour('2026-04-21', 10, 1)],
        agentStatus: [
          agent('2026-04-21', 'u-a', hourlyRange(9, 12)),
          agent('2026-04-21', 'u-b', hourlyRange(13, 15)),
        ],
      }),
    );
    const tuesday10 = out.heatmap.find((c) => c.dow === 2 && c.hour === 10);
    expect(tuesday10?.staff).toBe(1); // only u-a online at 10am
    const tuesday13 = out.heatmap.find((c) => c.dow === 2 && c.hour === 13);
    expect(tuesday13?.staff).toBe(1); // only u-b online at 1pm
    const tuesday3am = out.heatmap.find((c) => c.dow === 2 && c.hour === 3);
    expect(tuesday3am?.staff).toBe(0); // nobody online at 3am
  });

  it('averages distinct users per cell across same-weekday dates in the window', () => {
    // Two Tuesdays at hour 9: u-a online both, u-b online only once.
    // -> sum = 2 + 1 = 3, dates = 2 -> avg = 1.5
    const out = buildStaffingHeatmap(
      input({
        dailyStats: [
          dayWithHour('2026-04-14', 9, 1),
          dayWithHour('2026-04-21', 9, 1),
        ],
        agentStatus: [
          agent('2026-04-14', 'u-a', hourly(9)),
          agent('2026-04-21', 'u-a', hourly(9)),
          agent('2026-04-21', 'u-b', hourly(9)),
        ],
      }),
    );
    const tuesday9 = out.heatmap.find((c) => c.dow === 2 && c.hour === 9);
    expect(tuesday9?.staff).toBe(1.5);
  });

  it('skips agent rows with onlineSeconds=0', () => {
    const out = buildStaffingHeatmap(
      input({
        dailyStats: [dayWithHour('2026-04-21', 9, 1)],
        agentStatus: [
          agent('2026-04-21', 'u-a', hourly(9)),
          agent('2026-04-21', 'u-ghost', Array.from({ length: 24 }, () => 0)),
        ],
      }),
    );
    const tuesday9 = out.heatmap.find((c) => c.dow === 2 && c.hour === 9);
    expect(tuesday9?.staff).toBe(1);
  });

  it('drops agentStatus rows outside the window before averaging', () => {
    const out = buildStaffingHeatmap(
      input({
        dailyStats: [dayWithHour('2026-04-21', 9, 1)],
        agentStatus: [
          agent('2026-04-21', 'u-a', hourly(9)),
          agent('2026-01-01', 'u-old-a', hourly(9)),
          agent('2026-01-01', 'u-old-b', hourly(9)),
        ],
      }),
    );
    const tuesday9 = out.heatmap.find((c) => c.dow === 2 && c.hour === 9);
    expect(tuesday9?.staff).toBe(1);
  });

  it('drops weekend agentStatus rows when excludeWeekends is true', () => {
    const out = buildStaffingHeatmap(
      input({
        excludeWeekends: true,
        dailyStats: [dayWithHour('2026-04-21', 9, 1)],
        agentStatus: [
          agent('2026-04-25', 'u-sat-a', hourly(9)), // Saturday — dropped
          agent('2026-04-25', 'u-sat-b', hourly(9)),
          agent('2026-04-21', 'u-tue', hourly(9)),
        ],
      }),
    );
    expect(out.heatmap.find((c) => c.dow === 6)).toBeUndefined();
    const tuesday9 = out.heatmap.find((c) => c.dow === 2 && c.hour === 9);
    expect(tuesday9?.staff).toBe(1);
  });

  it('legacy fallback: rows missing hourlyOnlineSeconds broadcast across 24h', () => {
    // Old rows without the array fall back to "user online all day" so the
    // dashboard keeps rendering during migration windows.
    const legacyRow: AgentStatusRow = {
      date: '2026-04-21',
      userId: 'u-legacy',
      onlineSeconds: 3600,
    };
    const out = buildStaffingHeatmap(
      input({
        dailyStats: [dayWithHour('2026-04-21', 3, 1)], // 3am cell
        agentStatus: [legacyRow],
      }),
    );
    const cell = out.heatmap.find((c) => c.dow === 2 && c.hour === 3);
    expect(cell?.staff).toBe(1);
  });

  it('emits zero-staff cells across all 24h for dows with agentStatus data', () => {
    // Heatmap usually omits zero-ticket cells; staff overlay still surfaces
    // every hour of the row so admins can spot uncovered slots.
    const out = buildStaffingHeatmap(
      input({
        dailyStats: [
          { date: '2026-04-21', hourly: Array.from({ length: 24 }, () => 0) },
        ],
        agentStatus: [
          agent('2026-04-21', 'u-a', hourlyRange(9, 17)),
        ],
      }),
    );
    const tuesdayCells = out.heatmap.filter((c) => c.dow === 2);
    expect(tuesdayCells.length).toBe(24);
    const businessHourCells = tuesdayCells.filter((c) => c.hour >= 9 && c.hour <= 17);
    expect(businessHourCells.every((c) => c.staff === 1)).toBe(true);
    const offHourCells = tuesdayCells.filter((c) => c.hour < 9 || c.hour > 17);
    expect(offHourCells.every((c) => c.staff === 0)).toBe(true);
  });
});

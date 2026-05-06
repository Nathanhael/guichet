import { useState } from 'react';

/**
 * Dashboard Z3 — Staffing fit.
 *
 * Two stacked visualizations driven by `dashboard.getStaffingHeatmap`:
 *
 *   1. Today-vs-typical strip — 24 hourly slots showing the count of
 *      tickets that have already arrived today (accent) overlaid on the
 *      average count for the same hour-of-week across the window (muted).
 *      A vertical "now" marker shows the current local hour.
 *
 *   2. Weekday × hour heatmap — for each (dow, hour) cell, the average
 *      number of tickets that arrived in that hour over the past
 *      `daysCollected` days. Darker = busier. Today's weekday row is
 *      highlighted. Optional staff-coverage overlay shows the average
 *      number of agents online in each cell when toggled on.
 *
 * Empty / warm-up rules from spec §7:
 *   - daysCollected === 0 (loading or fresh partner) -> generic empty
 *   - daysCollected < 7 -> "Need 7+ days of data. X collected so far."
 *   - daysCollected >= 7 -> render both visualizations
 *
 * `excludeWeekends` hides Sat/Sun rows from the grid (the strip stays on
 * the today axis regardless — today might still be a weekend).
 */

export interface StaffingHeatmapData {
  heatmap: { dow: number; hour: number; tickets: number; staff?: number }[];
  todayVsTypical: { hour: number; todayCount: number; typicalCount: number }[];
  daysCollected: number;
}

export interface StaffingHeatmapZoneProps {
  data: StaffingHeatmapData | null;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  excludeWeekends?: boolean;
}

const DOW_LABELS_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LABELS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Render Mon → Sun (EU week start). When weekends are excluded, drop Sat + Sun.
const WEEK_ORDER_FULL = [1, 2, 3, 4, 5, 6, 0];
const WEEK_ORDER_NO_WEEKENDS = [1, 2, 3, 4, 5];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
// Label gutter: w-10 (40px) + gap-[2px] (2px) = 42px to align strip + axis with cells.
const GUTTER_PX = 42;

function formatHour(h: number): string {
  if (h === 0) return '12 AM';
  if (h === 12) return 'noon';
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

export function StaffingHeatmapZone({
  data,
  loading,
  error,
  onRetry,
  excludeWeekends,
}: StaffingHeatmapZoneProps) {
  const [showStaffOverlay, setShowStaffOverlay] = useState(false);

  if (loading) {
    return (
      <div data-testid="staffing-heatmap-loading" className="flex flex-col gap-2" aria-busy="true">
        <div className="h-6 bg-[var(--color-bg-elevated)] rounded animate-pulse" />
        <div className="h-32 bg-[var(--color-bg-elevated)] rounded animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="staffing-heatmap-error" className="flex items-center justify-between gap-3" role="alert">
        <span className="text-[13px] text-[var(--color-ink-muted)]">
          Could not load staffing data.
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="h-8 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[12px] text-[var(--color-ink)]"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  if (data.daysCollected < 7) {
    return (
      <div className="text-[13px] text-[var(--color-ink-muted)]">
        Need 7+ days of data. {data.daysCollected} collected so far.
      </div>
    );
  }

  const cellIndex = new Map<string, number>();
  const staffIndex = new Map<string, number>();
  for (const c of data.heatmap) {
    cellIndex.set(`${c.dow}:${c.hour}`, c.tickets);
    if (c.staff !== undefined) staffIndex.set(`${c.dow}:${c.hour}`, c.staff);
  }
  const hasStaffData = staffIndex.size > 0;

  const maxTickets = data.heatmap.reduce((m, c) => Math.max(m, c.tickets), 0);
  const visibleDows = excludeWeekends ? WEEK_ORDER_NO_WEEKENDS : WEEK_ORDER_FULL;

  const stripMax = data.todayVsTypical.reduce(
    (m, s) => Math.max(m, s.todayCount, s.typicalCount),
    0,
  );

  const now = new Date();
  const todayDow = now.getDay();
  const currentHour = now.getHours();
  const todayLongName = DOW_LABELS_LONG[todayDow];

  return (
    <div data-testid="staffing-heatmap-root" className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] text-[var(--color-ink-muted)] leading-snug max-w-prose">
          Average ticket arrivals by weekday and hour over the last {data.daysCollected} days.
          Darker cells = busier slots — use this to align staff coverage with demand.
        </p>
        {hasStaffData && (
          <button
            type="button"
            aria-pressed={showStaffOverlay}
            onClick={() => setShowStaffOverlay((v) => !v)}
            title="Show the average number of support staff online in each hour"
            className="shrink-0 h-7 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[11px] text-[var(--color-ink)] aria-pressed:bg-[var(--color-accent)] aria-pressed:text-white"
          >
            {showStaffOverlay ? 'Hide staff coverage' : 'Show staff coverage'}
          </button>
        )}
      </div>

      <section aria-label="Today vs typical arrivals">
        <header className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
            Today vs. typical {todayLongName}
          </span>
          <div className="flex items-center gap-3 text-[11px] text-[var(--color-ink-muted)]">
            <span className="flex items-center gap-1">
              <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-sm bg-[var(--color-accent)]" />
              Today
            </span>
            <span className="flex items-center gap-1">
              <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-sm bg-[var(--color-ink-muted)] opacity-30" />
              Typical
            </span>
          </div>
        </header>
        <div className="relative" style={{ paddingLeft: GUTTER_PX }}>
          <div
            data-testid="staffing-today-strip"
            className="flex items-end gap-[2px] h-16 relative"
          >
            {data.todayVsTypical.map((slot) => {
              const todayH = stripMax > 0 ? (slot.todayCount / stripMax) * 100 : 0;
              const typicalH = stripMax > 0 ? (slot.typicalCount / stripMax) * 100 : 0;
              const isCurrentHour = slot.hour === currentHour;
              return (
                <div
                  key={slot.hour}
                  data-testid={`staffing-today-slot-${slot.hour}`}
                  data-today={slot.todayCount}
                  data-typical={slot.typicalCount}
                  className={`flex-1 relative h-full ${isCurrentHour ? 'outline outline-1 outline-[var(--color-accent)] outline-offset-[-1px] rounded-sm' : ''}`}
                  title={`${formatHour(slot.hour)} — today ${slot.todayCount.toFixed(1)}, typical ${slot.typicalCount.toFixed(1)}`}
                >
                  <div
                    className="absolute bottom-0 left-0 right-0 bg-[var(--color-ink-muted)] opacity-30 rounded-t-sm"
                    style={{ height: `${typicalH}%` }}
                  />
                  <div
                    className="absolute bottom-0 left-0 right-0 bg-[var(--color-accent)] rounded-t-sm"
                    style={{ height: `${todayH}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-[var(--color-ink-muted)]">
            <span>12 AM</span>
            <span>6 AM</span>
            <span>noon</span>
            <span>6 PM</span>
            <span>11 PM</span>
          </div>
        </div>
      </section>

      <section aria-label="Weekday × hour heatmap">
        <header className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
            Average tickets per hour
            {showStaffOverlay && hasStaffData ? ' · staff count overlay' : ''}
          </span>
          <HeatmapLegend max={maxTickets} />
        </header>
        <div data-testid="staffing-heatmap-grid" className="flex flex-col gap-[2px]">
          {visibleDows.map((dow) => {
            const isToday = dow === todayDow;
            return (
              <div
                key={dow}
                data-testid={`staffing-row-${dow}`}
                data-is-today={isToday}
                className="flex items-center gap-[2px]"
              >
                <span
                  className={`w-10 text-[11px] ${isToday ? 'text-[var(--color-ink)] font-medium' : 'text-[var(--color-ink-muted)]'}`}
                >
                  {DOW_LABELS_FULL[dow]}
                  {isToday && <span aria-hidden className="ml-1 text-[var(--color-accent)]">•</span>}
                </span>
                {HOURS.map((hour) => {
                  const tickets = cellIndex.get(`${dow}:${hour}`) ?? 0;
                  const staff = staffIndex.get(`${dow}:${hour}`);
                  const intensity = maxTickets > 0 ? tickets / maxTickets : 0;
                  const showBadge = showStaffOverlay && staff !== undefined;
                  return (
                    <div
                      key={hour}
                      data-testid={`staffing-cell-${dow}-${hour}`}
                      data-tickets={tickets}
                      data-intensity={intensity}
                      className="flex-1 h-5 rounded-sm flex items-center justify-center"
                      style={{
                        backgroundColor:
                          intensity > 0
                            ? `color-mix(in srgb, var(--color-accent) ${Math.round(intensity * 100)}%, transparent)`
                            : 'var(--color-bg-elevated)',
                      }}
                      title={`${DOW_LABELS_LONG[dow]} ${formatHour(hour)} — ${tickets.toFixed(1)} tickets/h${staff !== undefined ? `, ${staff.toFixed(1)} staff online` : ''}`}
                    >
                      {showBadge && (
                        <span
                          data-testid={`staffing-cell-staff-${dow}-${hour}`}
                          className="text-[9px] font-medium text-[var(--color-ink)] leading-none"
                        >
                          {staff < 10 ? staff.toFixed(1).replace(/\.0$/, '') : Math.round(staff)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="flex mt-1" style={{ paddingLeft: GUTTER_PX }}>
          {HOURS.map((h) => (
            <span
              key={h}
              className="flex-1 text-[10px] text-[var(--color-ink-muted)] text-center"
            >
              {h % 4 === 0 ? formatHour(h) : ''}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

function HeatmapLegend({ max }: { max: number }) {
  if (max <= 0) return null;
  const stops = [0.15, 0.4, 0.65, 0.9];
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-ink-muted)]">
      <span>0</span>
      <div className="flex gap-[1px]">
        {stops.map((s) => (
          <span
            key={s}
            className="inline-block w-3 h-3 rounded-sm"
            style={{
              backgroundColor: `color-mix(in srgb, var(--color-accent) ${Math.round(s * 100)}%, transparent)`,
            }}
          />
        ))}
      </div>
      <span>{max.toFixed(1)}/h</span>
    </div>
  );
}

export default StaffingHeatmapZone;

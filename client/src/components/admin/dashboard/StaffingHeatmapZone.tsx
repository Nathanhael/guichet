import { useState } from 'react';
import { trpc } from '../../../utils/trpc';

/**
 * Dashboard Z3 — Staffing fit.
 *
 * Two stacked visualizations driven by `dashboard.getStaffingHeatmap`,
 * plus an auto-derived insights row that surfaces the busiest slot and
 * the worst staffing-fit slot so admins don't have to scan 168 cells.
 *
 *   1. Today vs. typical strip — 24 hourly slots showing the count of
 *      tickets that have already arrived today (accent) overlaid on the
 *      average count for the same hour-of-week across the window (muted).
 *      The current local hour is outlined.
 *
 *   2. Weekday × hour heatmap — for each (dow, hour) cell, the average
 *      number of tickets that arrived in that hour over the past
 *      `daysCollected` days. Darker = busier. Today's weekday row is
 *      highlighted. Cells where the per-hour ticket:staff ratio crosses
 *      a "thin coverage" threshold are outlined in red so understaffed
 *      slots stand out at a glance. Optional badge shows the average
 *      staff online count in each cell.
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
  /**
   * Tickets-per-staff-per-hour above which a cell is flagged understaffed.
   * Sourced from `partner.dashboardConfig.ticketsPerStaffPerHour`. Falls back
   * to {@link DEFAULT_THIN_COVERAGE_RATIO} when not configured.
   */
  thinCoverageRatio?: number;
}

export const DEFAULT_THIN_COVERAGE_RATIO = 5;

const DOW_LABELS_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LABELS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Render Mon → Sun (EU week start). When weekends are excluded, drop Sat + Sun.
const WEEK_ORDER_FULL = [1, 2, 3, 4, 5, 6, 0];
const WEEK_ORDER_NO_WEEKENDS = [1, 2, 3, 4, 5];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
// Label gutter: w-10 (40px) + gap-[2px] (2px) = 42px to align strip + axis with cells.
const GUTTER_PX = 42;
// Below this hourly arrival rate, ratios are noisy (rounding artefacts on
// rare slots) so we don't flag understaffing.
const MIN_TICKETS_FOR_FIT_FLAG = 0.5;

function formatHour(h: number): string {
  if (h === 0) return '12 AM';
  if (h === 12) return 'noon';
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

function fmt(n: number): string {
  return n < 10 ? n.toFixed(1).replace(/\.0$/, '') : Math.round(n).toString();
}

function getLocalTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  } catch {
    return 'local';
  }
}

interface CellInsight {
  dow: number;
  hour: number;
  tickets: number;
  staff?: number;
  ratio?: number;
}

function deriveInsights(
  cells: StaffingHeatmapData['heatmap'],
  visibleDows: number[],
  thinRatio: number,
): { busiest?: CellInsight; thinnest?: CellInsight; thinCount: number } {
  const dowSet = new Set(visibleDows);
  const inWindow = cells.filter((c) => dowSet.has(c.dow));
  if (inWindow.length === 0) return { thinCount: 0 };

  let busiest: CellInsight | undefined;
  let thinnest: CellInsight | undefined;
  let thinCount = 0;
  for (const c of inWindow) {
    if (!busiest || c.tickets > busiest.tickets) {
      busiest = { dow: c.dow, hour: c.hour, tickets: c.tickets, staff: c.staff };
    }
    if (
      c.staff !== undefined &&
      c.staff > 0 &&
      c.tickets >= MIN_TICKETS_FOR_FIT_FLAG
    ) {
      const ratio = c.tickets / c.staff;
      if (ratio > thinRatio) thinCount += 1;
      if (!thinnest || ratio > (thinnest.ratio ?? 0)) {
        thinnest = { dow: c.dow, hour: c.hour, tickets: c.tickets, staff: c.staff, ratio };
      }
    }
  }
  return { busiest, thinnest, thinCount };
}

export function StaffingHeatmapZone({
  data,
  loading,
  error,
  onRetry,
  excludeWeekends,
  thinCoverageRatio,
}: StaffingHeatmapZoneProps) {
  const [showStaffNumbers, setShowStaffNumbers] = useState(true);
  const thinRatio = thinCoverageRatio ?? DEFAULT_THIN_COVERAGE_RATIO;

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
  const insights = deriveInsights(data.heatmap, visibleDows, thinRatio);

  const stripMax = data.todayVsTypical.reduce(
    (m, s) => Math.max(m, s.todayCount, s.typicalCount),
    0,
  );

  const now = new Date();
  const todayDow = now.getDay();
  const currentHour = now.getHours();
  const todayLongName = DOW_LABELS_LONG[todayDow];
  const tz = getLocalTz();

  return (
    <div data-testid="staffing-heatmap-root" className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] text-[var(--color-ink-muted)] leading-snug max-w-prose">
          Average ticket arrivals by weekday and hour over the last {data.daysCollected} days.
          Darker cells = busier slots. <span className="text-[var(--color-danger,#ef4444)]">Red outline</span> = thin coverage (more than {thinRatio} tickets per staff/hour).
          <span className="block mt-0.5 text-[10.5px] opacity-80">Times in {tz}.</span>
        </p>
        <ThinRatioEditor current={thinRatio} />
        {hasStaffData && (
          <button
            type="button"
            aria-pressed={showStaffNumbers}
            onClick={() => setShowStaffNumbers((v) => !v)}
            title="Show the average number of support staff online inside each cell"
            className="shrink-0 h-7 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[11px] text-[var(--color-ink)] aria-pressed:bg-[var(--color-accent)] aria-pressed:text-white"
          >
            {showStaffNumbers ? 'Hide staff numbers' : 'Show staff numbers'}
          </button>
        )}
      </div>

      {(insights.busiest || insights.thinnest) && (
        <div
          data-testid="staffing-insights"
          className="flex flex-wrap gap-2 text-[11px]"
        >
          {insights.busiest && (
            <InsightChip
              tone="neutral"
              label="Busiest hour"
              value={`${DOW_LABELS_FULL[insights.busiest.dow]} ${formatHour(insights.busiest.hour)}`}
              detail={`${fmt(insights.busiest.tickets)} tickets/h${
                insights.busiest.staff !== undefined ? ` · ${fmt(insights.busiest.staff)} staff` : ''
              }`}
            />
          )}
          {insights.thinnest && insights.thinnest.ratio !== undefined && insights.thinnest.ratio > thinRatio && (
            <InsightChip
              tone="warn"
              label="Thinnest coverage"
              value={`${DOW_LABELS_FULL[insights.thinnest.dow]} ${formatHour(insights.thinnest.hour)}`}
              detail={`${fmt(insights.thinnest.tickets)} tickets vs ${fmt(insights.thinnest.staff ?? 0)} staff (${insights.thinnest.ratio.toFixed(1)}× ratio)`}
            />
          )}
          {hasStaffData && insights.thinCount > 1 && (
            <InsightChip
              tone="muted"
              label="Slots flagged"
              value={`${insights.thinCount} understaffed hours`}
              detail="across the visible week"
            />
          )}
        </div>
      )}

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
        <div className="relative" style={{ paddingLeft: GUTTER_PX, paddingTop: 14 }}>
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
                  title={`${formatHour(slot.hour)} — today ${fmt(slot.todayCount)}, typical ${fmt(slot.typicalCount)}`}
                >
                  {isCurrentHour && (
                    <span
                      aria-hidden
                      className="absolute -top-[14px] left-1/2 -translate-x-1/2 text-[9px] font-medium uppercase tracking-widest text-[var(--color-accent)] leading-none whitespace-nowrap"
                    >
                      Now
                    </span>
                  )}
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
            Typical demand pattern
            {hasStaffData ? ` · ${showStaffNumbers ? 'staff per hour' : 'tickets per hour'}` : ''}
          </span>
          <HeatmapLegend max={maxTickets} hasStaffData={hasStaffData} />
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
                  const ratio =
                    staff !== undefined && staff > 0 && tickets >= MIN_TICKETS_FOR_FIT_FLAG
                      ? tickets / staff
                      : null;
                  const isThin = ratio !== null && ratio > thinRatio;
                  const showBadge = showStaffNumbers && staff !== undefined;
                  const ringClass = isThin
                    ? 'ring-1 ring-[var(--color-danger,#ef4444)] ring-inset'
                    : '';
                  return (
                    <div
                      key={hour}
                      data-testid={`staffing-cell-${dow}-${hour}`}
                      data-tickets={tickets}
                      data-staff={staff ?? ''}
                      data-thin={isThin}
                      data-intensity={intensity}
                      className={`flex-1 h-5 rounded-sm flex items-center justify-center ${ringClass}`}
                      style={{
                        backgroundColor:
                          intensity > 0
                            ? `color-mix(in srgb, var(--color-accent) ${Math.round(intensity * 100)}%, transparent)`
                            : 'var(--color-bg-elevated)',
                      }}
                      title={
                        `${DOW_LABELS_LONG[dow]} ${formatHour(hour)} — ${fmt(tickets)} tickets/h` +
                        (staff !== undefined ? `, ${fmt(staff)} staff` : '') +
                        (isThin ? ` · thin coverage (${ratio!.toFixed(1)}× ratio)` : '')
                      }
                    >
                      {showBadge && (
                        <span
                          data-testid={`staffing-cell-staff-${dow}-${hour}`}
                          className="text-[9px] font-medium text-[var(--color-ink)] leading-none"
                        >
                          {fmt(staff)}
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

interface ThinRatioEditorProps {
  current: number;
}

/**
 * Inline admin-only editor for `partner.dashboardConfig.ticketsPerStaffPerHour`.
 * Lives inside the staffing-fit zone header so the knob sits next to the
 * signal it tunes — no separate settings page for one number.
 */
function ThinRatioEditor({ current }: ThinRatioEditorProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string>(current.toString());
  const [localError, setLocalError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const mutation = trpc.partner.updateDashboardConfig.useMutation({
    onSuccess: () => {
      utils.partner.getManifest.invalidate();
      setOpen(false);
    },
  });

  function handleSave() {
    setLocalError(null);
    const trimmed = value.trim();
    if (trimmed === '') {
      setLocalError('Required.');
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setLocalError('Must be a number.');
      return;
    }
    if (parsed < 0.5 || parsed > 50) {
      setLocalError('0.5 – 50.');
      return;
    }
    if (Math.abs(parsed - current) < 0.01) {
      setOpen(false);
      return;
    }
    mutation.mutate({ ticketsPerStaffPerHour: parsed });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(current.toString());
          setLocalError(null);
          mutation.reset();
          setOpen(true);
        }}
        title="Adjust the tickets-per-staff threshold for the understaffed flag"
        className="shrink-0 h-7 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[11px] text-[var(--color-ink-muted)]"
      >
        Threshold: {current}/h
      </button>
    );
  }

  const errorMsg = localError ?? (mutation.error ? mutation.error.message : null);

  return (
    <div className="shrink-0 flex flex-col items-end gap-1 text-[11px]">
      <div className="flex items-center gap-1.5">
        <label htmlFor="thin-ratio-input" className="text-[var(--color-ink-muted)]">
          Thin above
        </label>
        <input
          id="thin-ratio-input"
          type="number"
          min={0.5}
          max={50}
          step={0.5}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (localError) setLocalError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') setOpen(false);
          }}
          autoFocus
          className={`w-16 h-7 px-2 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] border ${
            errorMsg ? 'border-[var(--color-danger,#ef4444)]' : 'border-[var(--color-border)]'
          } text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)]`}
        />
        <span className="text-[var(--color-ink-muted)]">/h</span>
        <button
          type="button"
          onClick={handleSave}
          disabled={mutation.isPending}
          className="h-7 px-2 rounded-[var(--radius-btn)] bg-[var(--color-accent)] text-white text-[11px] disabled:opacity-50"
        >
          {mutation.isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-7 px-2 rounded-[var(--radius-btn)] text-[11px] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          Cancel
        </button>
      </div>
      {errorMsg && (
        <span className="text-[10px] text-[var(--color-danger,#ef4444)]">{errorMsg}</span>
      )}
    </div>
  );
}

interface InsightChipProps {
  tone: 'neutral' | 'warn' | 'muted';
  label: string;
  value: string;
  detail: string;
}

function InsightChip({ tone, label, value, detail }: InsightChipProps) {
  const toneClass =
    tone === 'warn'
      ? 'border-[var(--color-danger,#ef4444)] text-[var(--color-ink)]'
      : tone === 'muted'
      ? 'border-[var(--color-border)] text-[var(--color-ink-muted)]'
      : 'border-[var(--color-border)] text-[var(--color-ink)]';
  return (
    <div className={`inline-flex items-center gap-2 rounded-[var(--radius-btn)] border px-2.5 py-1 ${toneClass}`}>
      <span className="text-[10px] uppercase tracking-wide text-[var(--color-ink-muted)]">{label}</span>
      <span className="font-medium">{value}</span>
      <span className="text-[var(--color-ink-muted)]">· {detail}</span>
    </div>
  );
}

function HeatmapLegend({ max, hasStaffData }: { max: number; hasStaffData: boolean }) {
  if (max <= 0) return null;
  const stops = [0.15, 0.4, 0.65, 0.9];
  return (
    <div className="flex items-center gap-3 text-[10px] text-[var(--color-ink-muted)]">
      <div className="flex items-center gap-1.5">
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
        <span>{fmt(max)}/h</span>
      </div>
      {hasStaffData && (
        <span className="flex items-center gap-1">
          <span
            aria-hidden
            className="inline-block w-3 h-3 rounded-sm ring-1 ring-[var(--color-danger,#ef4444)] ring-inset bg-[var(--color-bg-elevated)]"
          />
          thin
        </span>
      )}
    </div>
  );
}

export default StaffingHeatmapZone;

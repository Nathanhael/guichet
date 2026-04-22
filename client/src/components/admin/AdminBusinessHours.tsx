import { useEffect, useState } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { trpc } from '../../utils/trpc';
import {
  BusinessHoursSchedule,
} from '../../types';
import {
  BUSINESS_HOURS_DAY_ORDER,
  createDefaultBusinessHoursSchedule,
  evaluateBusinessHoursStatus,
  formatBusinessHoursTimestamp,
  getBusinessHoursDraftIssues,
  getBusinessHoursReason,
  getBusinessHoursSummary,
  sortBusinessHoursExceptions,
} from '../../utils/businessHours';
import { useBusinessHours } from '../../hooks/useBusinessHours';
import { useT } from '../../i18n';
import TimezonePicker from '../TimezonePicker';

// Shared Soft Product style constants
const CARD = 'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)]';
const INPUT = 'h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';
const PRIMARY_BTN = 'h-9 px-4 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-accent)] hover:brightness-110 text-white text-[13px] font-medium shadow-[var(--shadow-soft)] disabled:opacity-40 transition-all';
const SECONDARY_BTN = 'h-9 px-3 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[var(--color-ink)] text-[13px] font-medium transition-colors disabled:opacity-40';
const GHOST_BTN = 'h-8 px-2.5 inline-flex items-center gap-1 rounded-[var(--radius-btn)] text-[12px] text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors';
const FIELD_LABEL = 'block text-[11px] font-medium text-[var(--color-ink-muted)] mb-1.5';
const COL_HEAD = 'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]';
const SECTION_LABEL = 'text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--color-ink-muted)]';

function cloneSchedule(schedule: BusinessHoursSchedule) {
  return JSON.parse(JSON.stringify(schedule)) as BusinessHoursSchedule;
}

function createExceptionId() {
  return `exception-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextExceptionDate(schedule: BusinessHoursSchedule, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const seed = `${byType.year}-${byType.month}-${byType.day}`;
  const usedDates = new Set(schedule.exceptions.map((exception) => exception.date));

  for (let offset = 0; offset < 365; offset++) {
    const candidate = new Date(`${seed}T00:00:00`);
    candidate.setDate(candidate.getDate() + offset);
    const yyyy = candidate.getFullYear();
    const mm = String(candidate.getMonth() + 1).padStart(2, '0');
    const dd = String(candidate.getDate()).padStart(2, '0');
    const candidateDate = `${yyyy}-${mm}-${dd}`;
    if (!usedDates.has(candidateDate)) {
      return candidateDate;
    }
  }

  return seed;
}

// Segmented closed/open toggle — Soft Product pill pattern. Keeps the
// keyboard affordance of a button but reads like a stateful switch.
function OpenClosedToggle({
  closed,
  openLabel,
  closedLabel,
  onToggle,
}: { closed: boolean; openLabel: string; closedLabel: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={closed}
      className={`inline-flex items-center rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] p-0.5 text-[12px] font-medium transition-colors`}
    >
      <span
        className={`px-3 h-7 inline-flex items-center rounded-[var(--radius-pill)] transition-colors ${
          !closed ? 'bg-[var(--color-ok)] text-white shadow-[var(--shadow-soft)]' : 'text-[var(--color-ink-muted)]'
        }`}
      >
        {openLabel}
      </span>
      <span
        className={`px-3 h-7 inline-flex items-center rounded-[var(--radius-pill)] transition-colors ${
          closed ? 'bg-[var(--color-ink)] text-[var(--color-bg)] shadow-[var(--shadow-soft)]' : 'text-[var(--color-ink-muted)]'
        }`}
      >
        {closedLabel}
      </span>
    </button>
  );
}

export default function AdminBusinessHours() {
  const t = useT();
  const { schedule: fetchedSchedule, status, isLoading, invalidate } = useBusinessHours();
  const [schedule, setSchedule] = useState<BusinessHoursSchedule>(createDefaultBusinessHoursSchedule());
  const [isDirty, setIsDirty] = useState(false);
  const draftStatus = evaluateBusinessHoursStatus(schedule);
  const draftIssues = getBusinessHoursDraftIssues(schedule, t);

  const mutation = trpc.partner.updateBusinessHours.useMutation({
    onSuccess: async (data) => {
      setSchedule({
        ...data.schedule,
        exceptions: sortBusinessHoursExceptions(data.schedule.exceptions),
      });
      setIsDirty(false);
      await invalidate();
    },
  });

  // Sync local form state from the server schedule when it arrives (and only
  // if the user hasn't already dirtied the form). Prop→state sync is load-bearing:
  // the user edits in place and submits the whole schedule at once.
  useEffect(() => {
    if (!isDirty && fetchedSchedule) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSchedule({
        ...cloneSchedule(fetchedSchedule),
        exceptions: sortBusinessHoursExceptions(fetchedSchedule.exceptions),
      });
    }
  }, [fetchedSchedule, isDirty]);

  function updateSchedule(updater: (next: BusinessHoursSchedule) => void) {
    setSchedule((current) => {
      const next = cloneSchedule(current);
      updater(next);
      return next;
    });
    setIsDirty(true);
  }

  if (isLoading) return <div className="p-8 text-[13px] text-[var(--color-ink-muted)]">{t('loading')}</div>;

  return (
    <div className="min-w-[1120px] max-w-5xl space-y-5">
      <div className="flex items-end justify-between gap-6 pb-1">
        <div>
          <h2 className="text-xl font-semibold text-[var(--color-ink)] tracking-tight">{t('bh_title')}</h2>
          <p className="text-[13px] text-[var(--color-ink-soft)] mt-1">{t('bh_desc')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setSchedule(createDefaultBusinessHoursSchedule(schedule.timezone));
              setIsDirty(true);
            }}
            className={SECONDARY_BTN}
          >
            {t('bh_reset')}
          </button>
          <button
            disabled={!isDirty || mutation.isPending || draftIssues.length > 0}
            onClick={() => {
              if (draftIssues.length > 0) return;
              mutation.mutate({
                schedule: {
                  ...schedule,
                  exceptions: sortBusinessHoursExceptions(schedule.exceptions),
                },
              });
            }}
            className={PRIMARY_BTN}
          >
            {mutation.isPending ? t('bh_saving') : t('bh_save')}
          </button>
        </div>
      </div>

      {mutation.error && (
        <div
          className={`${CARD} p-4 border-l-4 border-[var(--color-urgent)] flex items-start gap-3`}
          role="alert"
        >
          <AlertTriangle className="w-5 h-5 text-[var(--color-urgent)] mt-0.5 shrink-0" aria-hidden />
          <div>
            <p className="text-[13px] font-semibold text-[var(--color-ink)]">{t('bh_validation_error')}</p>
            <p className="text-[12px] text-[var(--color-ink-soft)] mt-1">{mutation.error.message}</p>
          </div>
        </div>
      )}

      {draftIssues.length > 0 && (
        <div
          className={`${CARD} p-4 border-l-4 border-[var(--color-accent-amber)] flex items-start gap-3`}
          role="alert"
        >
          <AlertTriangle className="w-5 h-5 text-[var(--color-accent-amber)] mt-0.5 shrink-0" aria-hidden />
          <div className="space-y-1">
            <p className="text-[13px] font-semibold text-[var(--color-ink)]">{t('bh_draft_issues')}</p>
            <ul className="space-y-0.5">
              {draftIssues.map((issue) => (
                <li key={issue} className="text-[12px] text-[var(--color-ink-soft)]">• {issue}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className={`${CARD} p-5 space-y-5`}>
        <div className="grid grid-cols-[240px_1fr_1fr] gap-4 items-stretch">
          <div>
            <TimezonePicker
              label={t('bh_timezone')}
              value={schedule.timezone}
              onChange={(tz) => {
                setSchedule((current) => ({ ...current, timezone: tz }));
                setIsDirty(true);
              }}
            />
          </div>

          <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] p-3.5">
            <p className={SECTION_LABEL}>{t('bh_saved_status')}</p>
            <p className="text-[13px] font-medium text-[var(--color-ink)] mt-1.5">{getBusinessHoursSummary(status, t)}</p>
            {getBusinessHoursReason(status) && (
              <p className="text-[11px] text-[var(--color-ink-muted)] mt-1.5">
                {getBusinessHoursReason(status)}
              </p>
            )}
            {status?.nextOpenAt && (
              <p className="text-[11px] text-[var(--color-ink-muted)] mt-1.5">
                <span className="text-[var(--color-ink-soft)]">{t('bh_next_open')}</span> {formatBusinessHoursTimestamp(status.nextOpenAt, status.timezone)}
              </p>
            )}
            {status?.nextCloseAt && (
              <p className="text-[11px] text-[var(--color-ink-muted)] mt-0.5">
                <span className="text-[var(--color-ink-soft)]">{t('bh_next_close')}</span> {formatBusinessHoursTimestamp(status.nextCloseAt, status.timezone)}
              </p>
            )}
          </div>

          <div className="rounded-[var(--radius-card)] bg-[var(--color-accent-soft)] p-3.5">
            <p className={SECTION_LABEL}>{t('bh_draft_preview')}</p>
            <p className="text-[13px] font-medium text-[var(--color-ink)] mt-1.5">{getBusinessHoursSummary(draftStatus, t)}</p>
            {getBusinessHoursReason(draftStatus) && (
              <p className="text-[11px] text-[var(--color-ink-soft)] mt-1.5">
                {getBusinessHoursReason(draftStatus)}
              </p>
            )}
            {draftStatus.nextOpenAt && (
              <p className="text-[11px] text-[var(--color-ink-soft)] mt-1.5">
                <span className="text-[var(--color-ink)]">{t('bh_next_open')}</span> {formatBusinessHoursTimestamp(draftStatus.nextOpenAt, draftStatus.timezone)}
              </p>
            )}
            {draftStatus.nextCloseAt && (
              <p className="text-[11px] text-[var(--color-ink-soft)] mt-0.5">
                <span className="text-[var(--color-ink)]">{t('bh_next_close')}</span> {formatBusinessHoursTimestamp(draftStatus.nextCloseAt, draftStatus.timezone)}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className={COL_HEAD}>{t('bh_col_day')}</th>
                <th className={COL_HEAD}>{t('bh_col_closed')}</th>
                <th className={COL_HEAD}>{t('bh_col_windows')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {BUSINESS_HOURS_DAY_ORDER.map((day) => {
                const daySchedule = schedule.weekly[day];
                return (
                  <tr key={day}>
                    <td className="px-4 py-4 text-[13px] font-medium text-[var(--color-ink)]">{t(`day_${day}`)}</td>
                    <td className="px-4 py-4">
                      <OpenClosedToggle
                        closed={daySchedule.closed}
                        openLabel={t('bh_open')}
                        closedLabel={t('bh_closed')}
                        onToggle={() => updateSchedule((next) => {
                          next.weekly[day].closed = !next.weekly[day].closed;
                          if (next.weekly[day].closed) next.weekly[day].windows = [];
                          if (!next.weekly[day].closed && next.weekly[day].windows.length === 0) {
                            next.weekly[day].windows = [{ start: '07:30', end: '22:30' }];
                          }
                        })}
                      />
                    </td>
                    <td className="px-4 py-4">
                      {daySchedule.closed ? (
                        <span className="text-[12px] text-[var(--color-ink-muted)] italic">{t('bh_no_intake_windows')}</span>
                      ) : (
                        <div className="space-y-2.5">
                          {daySchedule.windows.map((window, index) => (
                            <div key={`${day}-${index}`} className="flex items-center gap-2">
                              <input
                                type="time"
                                value={window.start}
                                onChange={(e) => updateSchedule((next) => {
                                  next.weekly[day].windows[index].start = e.target.value;
                                })}
                                className={`${INPUT} w-[110px]`}
                              />
                              <span className="text-[11px] text-[var(--color-ink-muted)]">{t('bh_to')}</span>
                              <input
                                type="time"
                                value={window.end}
                                onChange={(e) => updateSchedule((next) => {
                                  next.weekly[day].windows[index].end = e.target.value;
                                })}
                                className={`${INPUT} w-[110px]`}
                              />
                              <button
                                onClick={() => updateSchedule((next) => {
                                  next.weekly[day].windows.splice(index, 1);
                                  if (next.weekly[day].windows.length === 0) {
                                    next.weekly[day].closed = true;
                                  }
                                })}
                                className={GHOST_BTN}
                                aria-label={t('bh_remove')}
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden />
                                {t('bh_remove')}
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => updateSchedule((next) => {
                              next.weekly[day].windows.push({ start: '07:30', end: '22:30' });
                            })}
                            className={SECONDARY_BTN}
                          >
                            <Plus className="w-3.5 h-3.5" aria-hidden />
                            {t('bh_add_window')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
            <div>
              <p className="text-[13px] font-semibold text-[var(--color-ink)]">{t('bh_exceptions')}</p>
              <p className="text-[12px] text-[var(--color-ink-soft)] mt-0.5">{t('bh_exceptions_desc')}</p>
            </div>
            <button
              onClick={() => {
                setSchedule((current) => ({
                  ...current,
                  exceptions: sortBusinessHoursExceptions([
                    ...current.exceptions,
                    {
                      id: createExceptionId(),
                      date: nextExceptionDate(current, current.timezone),
                      closed: true,
                      note: '',
                    },
                  ]),
                }));
                setIsDirty(true);
              }}
              className={SECONDARY_BTN}
            >
              <Plus className="w-3.5 h-3.5" aria-hidden />
              {t('bh_add_exception')}
            </button>
          </div>

          <div className="p-4 space-y-3">
            {schedule.exceptions.length === 0 ? (
              <p className="text-[12px] text-[var(--color-ink-muted)] italic py-2">{t('bh_no_exceptions')}</p>
            ) : (
              sortBusinessHoursExceptions(schedule.exceptions).map((exception) => {
                const index = schedule.exceptions.findIndex((item) => item.id === exception.id);
                return (
                <div key={exception.id} className="rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)] p-4 space-y-3">
                  <div className="grid grid-cols-[180px_180px_1fr_auto] gap-3 items-end">
                    <div>
                      <label className={FIELD_LABEL}>{t('bh_date')}</label>
                      <input
                        type="date"
                        value={exception.date}
                        onChange={(e) => {
                          setSchedule((current) => {
                            const next = cloneSchedule(current);
                            next.exceptions[index].date = e.target.value;
                            next.exceptions = sortBusinessHoursExceptions(next.exceptions);
                            return next;
                          });
                          setIsDirty(true);
                        }}
                        className={`${INPUT} w-full`}
                      />
                    </div>
                    <div>
                      <label className={FIELD_LABEL}>{t('bh_mode')}</label>
                      <OpenClosedToggle
                        closed={!!exception.closed}
                        openLabel={t('bh_custom_hours')}
                        closedLabel={t('bh_closed')}
                        onToggle={() => {
                          setSchedule((current) => {
                            const next = cloneSchedule(current);
                            const item = next.exceptions[index];
                            item.closed = !item.closed;
                            if (!item.closed && (!item.windows || item.windows.length === 0)) {
                              item.windows = [{ start: '07:30', end: '22:30' }];
                            }
                            if (item.closed) {
                              item.windows = undefined;
                            }
                            next.exceptions = sortBusinessHoursExceptions(next.exceptions);
                            return next;
                          });
                          setIsDirty(true);
                        }}
                      />
                    </div>
                    <div>
                      <label className={FIELD_LABEL}>{t('bh_note')}</label>
                      <input
                        type="text"
                        value={exception.note ?? ''}
                        onChange={(e) => {
                          setSchedule((current) => {
                            const next = cloneSchedule(current);
                            next.exceptions[index].note = e.target.value;
                            next.exceptions = sortBusinessHoursExceptions(next.exceptions);
                            return next;
                          });
                          setIsDirty(true);
                        }}
                        className={`${INPUT} w-full`}
                        placeholder={t('bh_note_placeholder')}
                      />
                    </div>
                    <button
                      onClick={() => {
                        setSchedule((current) => ({
                          ...current,
                          exceptions: sortBusinessHoursExceptions(current.exceptions.filter((item) => item.id !== exception.id)),
                        }));
                        setIsDirty(true);
                      }}
                      className={GHOST_BTN}
                      aria-label={t('bh_remove')}
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden />
                      {t('bh_remove')}
                    </button>
                  </div>

                  {exception.note?.trim() && (
                    <p className="text-[11px] text-[var(--color-ink-muted)]">
                      <span className="text-[var(--color-ink-soft)]">{t('bh_current_note')}</span> {exception.note.trim()}
                    </p>
                  )}

                  {!exception.closed && (
                    <div className="space-y-2.5 pt-1 border-t border-[var(--color-border)]">
                      {(exception.windows ?? []).map((window, windowIndex) => (
                        <div key={`${exception.id}-${windowIndex}`} className="flex items-center gap-2 pt-2.5">
                          <input
                            type="time"
                            value={window.start}
                            onChange={(e) => {
                              setSchedule((current) => {
                                const next = cloneSchedule(current);
                                next.exceptions[index].windows![windowIndex].start = e.target.value;
                                next.exceptions = sortBusinessHoursExceptions(next.exceptions);
                                return next;
                              });
                              setIsDirty(true);
                            }}
                            className={`${INPUT} w-[110px]`}
                          />
                          <span className="text-[11px] text-[var(--color-ink-muted)]">{t('bh_to')}</span>
                          <input
                            type="time"
                            value={window.end}
                            onChange={(e) => {
                              setSchedule((current) => {
                                const next = cloneSchedule(current);
                                next.exceptions[index].windows![windowIndex].end = e.target.value;
                                next.exceptions = sortBusinessHoursExceptions(next.exceptions);
                                return next;
                              });
                              setIsDirty(true);
                            }}
                            className={`${INPUT} w-[110px]`}
                          />
                          <button
                            onClick={() => {
                              setSchedule((current) => {
                                const next = cloneSchedule(current);
                                next.exceptions[index].windows = (next.exceptions[index].windows ?? []).filter((_, i) => i !== windowIndex);
                                next.exceptions = sortBusinessHoursExceptions(next.exceptions);
                                return next;
                              });
                              setIsDirty(true);
                            }}
                            className={GHOST_BTN}
                            aria-label={t('bh_remove_window')}
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden />
                            {t('bh_remove_window')}
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          setSchedule((current) => {
                            const next = cloneSchedule(current);
                            next.exceptions[index].windows = [
                              ...(next.exceptions[index].windows ?? []),
                              { start: '07:30', end: '22:30' },
                            ];
                            next.exceptions = sortBusinessHoursExceptions(next.exceptions);
                            return next;
                          });
                          setIsDirty(true);
                        }}
                        className={SECONDARY_BTN}
                      >
                        <Plus className="w-3.5 h-3.5" aria-hidden />
                        {t('bh_add_window')}
                      </button>
                    </div>
                  )}
                </div>
              )})
            )}
          </div>
        </div>
      </div>

      <div className={`${CARD} p-4`}>
        <p className={SECTION_LABEL}>{t('bh_how_it_works')}</p>
        <p className="text-[12px] text-[var(--color-ink-soft)] leading-relaxed mt-1.5">
          {t('bh_how_it_works_desc')}
        </p>
      </div>
    </div>
  );
}

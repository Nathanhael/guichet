import { useEffect, useState } from 'react';
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

const TIMEZONES = [
  'Europe/Brussels', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Amsterdam', 'Europe/Madrid', 'Europe/Rome', 'Europe/Zurich',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney',
];

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

export default function AdminBusinessHours() {
  const t = useT();
  const { schedule: fetchedSchedule, status, isLoading, refetch } = useBusinessHours();
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
      await refetch();
    },
  });

  useEffect(() => {
    if (!isDirty && fetchedSchedule) {
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

  if (isLoading) return <div className="p-8 mono-label text-[var(--color-text-muted)]">{t('loading')}</div>;

  const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;
  const primaryWindow = weekdays
    .map((day) => schedule.weekly[day].windows[0])
    .find(Boolean);

  return (
    <div className="min-w-[1120px] max-w-5xl space-y-6">
      <div className="flex items-end justify-between gap-6 border-b border-[var(--color-border)] pb-4">
        <div>
          <h2 className="text-4xl font-bold uppercase tracking-tighter">{t('bh_title')}</h2>
          <p className="text-sm font-bold uppercase text-[var(--color-text-secondary)] mt-1 tracking-wide">{t('bh_desc')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setSchedule(createDefaultBusinessHoursSchedule(schedule.timezone));
              setIsDirty(true);
            }}
            className="btn-secondary"
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
                businessHoursStart: primaryWindow?.start ?? null,
                businessHoursEnd: primaryWindow?.end ?? null,
                businessHoursTimezone: schedule.timezone,
              });
            }}
            className="btn-primary disabled:opacity-30"
          >
            {mutation.isPending ? t('bh_saving') : t('bh_save')}
          </button>
        </div>
      </div>

      {mutation.error && (
        <div className="border border-[var(--color-border)] p-4 bg-[var(--color-text-primary)] text-[var(--color-bg-base)]">
          <p className="mono-label">{t('bh_validation_error')}</p>
          <p className="text-sm font-bold mt-2">{mutation.error.message}</p>
        </div>
      )}

      {draftIssues.length > 0 && (
        <div className="border border-[var(--color-border)] p-4 bg-[var(--color-text-primary)] text-[var(--color-bg-base)]">
          <p className="mono-label">{t('bh_draft_issues')}</p>
          <div className="mt-2 space-y-1 text-sm font-bold">
            {draftIssues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </div>
        </div>
      )}

      <div className="surface-card p-6 space-y-6">
        <div className="grid grid-cols-[220px_1fr_1fr] gap-6 items-end">
          <div>
            <label className="mono-label mb-2 block">{t('bh_timezone')}</label>
            <select
              value={schedule.timezone}
              onChange={(e) => {
                setSchedule((current) => ({ ...current, timezone: e.target.value }));
                setIsDirty(true);
              }}
              className="input-field w-full"
            >
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>

          <div className="border border-[var(--color-border)] p-4">
            <p className="mono-label text-[var(--color-text-secondary)] mb-1">{t('bh_saved_status')}</p>
            <p className="text-sm font-bold">{getBusinessHoursSummary(status, t)}</p>
            {getBusinessHoursReason(status) && (
              <p className="mono-label text-[var(--color-text-secondary)] mt-2">
                {getBusinessHoursReason(status)}
              </p>
            )}
            {status?.nextOpenAt && (
              <p className="mono-label text-[var(--color-text-secondary)] mt-2">
                {t('bh_next_open')} {formatBusinessHoursTimestamp(status.nextOpenAt, status.timezone)}
              </p>
            )}
            {status?.nextCloseAt && (
              <p className="mono-label text-[var(--color-text-secondary)] mt-1">
                {t('bh_next_close')} {formatBusinessHoursTimestamp(status.nextCloseAt, status.timezone)}
              </p>
            )}
          </div>

          <div className="border border-[var(--color-border)] p-4">
            <p className="mono-label text-[var(--color-text-secondary)] mb-1">{t('bh_draft_preview')}</p>
            <p className="text-sm font-bold">{getBusinessHoursSummary(draftStatus, t)}</p>
            {getBusinessHoursReason(draftStatus) && (
              <p className="mono-label text-[var(--color-text-secondary)] mt-2">
                {getBusinessHoursReason(draftStatus)}
              </p>
            )}
            {draftStatus.nextOpenAt && (
              <p className="mono-label text-[var(--color-text-secondary)] mt-2">
                {t('bh_next_open')} {formatBusinessHoursTimestamp(draftStatus.nextOpenAt, draftStatus.timezone)}
              </p>
            )}
            {draftStatus.nextCloseAt && (
              <p className="mono-label text-[var(--color-text-secondary)] mt-1">
                {t('bh_next_close')} {formatBusinessHoursTimestamp(draftStatus.nextCloseAt, draftStatus.timezone)}
              </p>
            )}
          </div>
        </div>

        <div className="border border-[var(--color-border)] overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-bg-elevated">
                <th className="px-4 py-3 font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide">{t('bh_col_day')}</th>
                <th className="px-4 py-3 font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide">{t('bh_col_closed')}</th>
                <th className="px-4 py-3 font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide">{t('bh_col_windows')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {BUSINESS_HOURS_DAY_ORDER.map((day) => {
                const daySchedule = schedule.weekly[day];
                return (
                  <tr key={day}>
                    <td className="px-4 py-4 text-sm font-bold uppercase tracking-wide">{t(`day_${day}`)}</td>
                    <td className="px-4 py-4">
                      <button
                        onClick={() => updateSchedule((next) => {
                          next.weekly[day].closed = !next.weekly[day].closed;
                          if (next.weekly[day].closed) next.weekly[day].windows = [];
                          if (!next.weekly[day].closed && next.weekly[day].windows.length === 0) {
                            next.weekly[day].windows = [{ start: '07:30', end: '22:30' }];
                          }
                        })}
                        className={`px-3 py-2 border mono-label ${
                          daySchedule.closed
                            ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)] border-[var(--color-border)]'
                            : 'border-[var(--color-border)]'
                        }`}
                      >
                        {daySchedule.closed ? t('bh_closed') : t('bh_open')}
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      {daySchedule.closed ? (
                        <span className="text-xs font-bold uppercase text-[var(--color-text-muted)] tracking-wide">{t('bh_no_intake_windows')}</span>
                      ) : (
                        <div className="space-y-3">
                          {daySchedule.windows.map((window, index) => (
                            <div key={`${day}-${index}`} className="flex items-center gap-3">
                              <input
                                type="time"
                                value={window.start}
                                onChange={(e) => updateSchedule((next) => {
                                  next.weekly[day].windows[index].start = e.target.value;
                                })}
                                className="input-field"
                              />
                              <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-secondary)]">{t('bh_to')}</span>
                              <input
                                type="time"
                                value={window.end}
                                onChange={(e) => updateSchedule((next) => {
                                  next.weekly[day].windows[index].end = e.target.value;
                                })}
                                className="input-field"
                              />
                              <button
                                onClick={() => updateSchedule((next) => {
                                  next.weekly[day].windows.splice(index, 1);
                                  if (next.weekly[day].windows.length === 0) {
                                    next.weekly[day].closed = true;
                                  }
                                })}
                                className="btn-secondary"
                              >
                                {t('bh_remove')}
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => updateSchedule((next) => {
                              next.weekly[day].windows.push({ start: '07:30', end: '22:30' });
                            })}
                            className="btn-secondary"
                          >
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

        <div className="border border-[var(--color-border)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border)] bg-bg-elevated flex items-center justify-between">
            <div>
              <p className="mono-label">{t('bh_exceptions')}</p>
              <p className="text-xs font-bold text-[var(--color-text-secondary)] mt-1">{t('bh_exceptions_desc')}</p>
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
              className="btn-secondary"
            >
              {t('bh_add_exception')}
            </button>
          </div>

          <div className="p-4 space-y-4">
            {schedule.exceptions.length === 0 ? (
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{t('bh_no_exceptions')}</p>
            ) : (
              sortBusinessHoursExceptions(schedule.exceptions).map((exception) => {
                const index = schedule.exceptions.findIndex((item) => item.id === exception.id);
                return (
                <div key={exception.id} className="border border-[var(--color-border)] p-4 space-y-3">
                  <div className="grid grid-cols-[180px_140px_1fr_auto] gap-3 items-end">
                    <div>
                      <label className="mono-label mb-2 block">{t('bh_date')}</label>
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
                        className="input-field w-full"
                      />
                    </div>
                    <div>
                      <label className="mono-label mb-2 block">{t('bh_mode')}</label>
                      <button
                      onClick={() => {
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
                        className={`w-full px-3 py-2 border mono-label ${
                          exception.closed
                            ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)] border-[var(--color-border)]'
                            : 'border-[var(--color-border)]'
                        }`}
                      >
                        {exception.closed ? t('bh_closed') : t('bh_custom_hours')}
                      </button>
                    </div>
                    <div>
                      <label className="mono-label mb-2 block">{t('bh_note')}</label>
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
                        className="input-field w-full"
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
                      className="btn-secondary"
                    >
                      {t('bh_remove')}
                    </button>
                  </div>

                  {exception.note?.trim() && (
                    <p className="mono-label text-[var(--color-text-secondary)]">
                      {t('bh_current_note')} {exception.note.trim()}
                    </p>
                  )}

                  {!exception.closed && (
                    <div className="space-y-3">
                      {(exception.windows ?? []).map((window, windowIndex) => (
                        <div key={`${exception.id}-${windowIndex}`} className="flex items-center gap-3">
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
                            className="input-field"
                          />
                          <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-secondary)]">{t('bh_to')}</span>
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
                            className="input-field"
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
                            className="btn-secondary"
                          >
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
                        className="btn-secondary"
                      >
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

      <div className="border border-[var(--color-border)] p-4">
        <p className="mono-label text-[var(--color-text-secondary)] mb-1">{t('bh_how_it_works')}</p>
        <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
          {t('bh_how_it_works_desc')}
        </p>
      </div>
    </div>
  );
}

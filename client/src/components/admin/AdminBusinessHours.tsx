import { useEffect, useState } from 'react';
import { trpc } from '../../utils/trpc';
import {
  BusinessHoursDayKey,
  BusinessHoursSchedule,
} from '../../types';
import {
  BUSINESS_HOURS_DAY_LABELS,
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
  const { schedule: fetchedSchedule, status, isLoading, refetch } = useBusinessHours();
  const [schedule, setSchedule] = useState<BusinessHoursSchedule>(createDefaultBusinessHoursSchedule());
  const [isDirty, setIsDirty] = useState(false);
  const draftStatus = evaluateBusinessHoursStatus(schedule);
  const draftIssues = getBusinessHoursDraftIssues(schedule);

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

  function updateDay(day: BusinessHoursDayKey, updater: (next: BusinessHoursSchedule) => void) {
    setSchedule((current) => {
      const next = cloneSchedule(current);
      updater(next);
      return next;
    });
    setIsDirty(true);
  }

  if (isLoading) return <div className="p-8 text-xs font-black uppercase tracking-widest opacity-50">Loading...</div>;

  const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;
  const primaryWindow = weekdays
    .map((day) => schedule.weekly[day].windows[0])
    .find(Boolean);

  return (
    <div className="min-w-[1120px] max-w-5xl space-y-6">
      <div className="flex items-end justify-between gap-6 border-b-4 border-black dark:border-white pb-4">
        <div>
          <h2 className="text-4xl font-black uppercase tracking-tighter">Business Hours</h2>
          <p className="text-sm font-bold uppercase opacity-60 mt-1 tracking-widest">Configure weekly intake windows for new agent tickets.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setSchedule(createDefaultBusinessHoursSchedule(schedule.timezone));
              setIsDirty(true);
            }}
            className="px-4 py-2 border-2 border-black dark:border-white text-[10px] font-black uppercase tracking-widest"
          >
            Reset
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
            className="px-6 py-2 bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white text-[10px] font-black uppercase tracking-widest disabled:opacity-30"
          >
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {mutation.error && (
        <div className="border-2 border-black dark:border-white p-4 bg-black text-white dark:bg-white dark:text-black">
          <p className="text-[10px] font-black uppercase tracking-widest">Validation error</p>
          <p className="text-sm font-bold mt-2">{mutation.error.message}</p>
        </div>
      )}

      {draftIssues.length > 0 && (
        <div className="border-2 border-black dark:border-white p-4 bg-black text-white dark:bg-white dark:text-black">
          <p className="text-[10px] font-black uppercase tracking-widest">Draft issues</p>
          <div className="mt-2 space-y-1 text-sm font-bold">
            {draftIssues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </div>
        </div>
      )}

      <div className="border-2 border-black dark:border-white p-6 space-y-6">
        <div className="grid grid-cols-[220px_1fr_1fr] gap-6 items-end">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-2">Timezone</label>
            <select
              value={schedule.timezone}
              onChange={(e) => {
                setSchedule((current) => ({ ...current, timezone: e.target.value }));
                setIsDirty(true);
              }}
              className="w-full bg-transparent border-2 border-black dark:border-white px-4 py-2 text-sm font-bold outline-none"
            >
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>

          <div className="border border-black/20 dark:border-white/20 p-4">
            <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-1">Saved status</p>
            <p className="text-sm font-bold">{getBusinessHoursSummary(status)}</p>
            {getBusinessHoursReason(status) && (
              <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mt-2">
                {getBusinessHoursReason(status)}
              </p>
            )}
            {status?.nextOpenAt && (
              <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mt-2">
                Next open {formatBusinessHoursTimestamp(status.nextOpenAt, status.timezone)}
              </p>
            )}
            {status?.nextCloseAt && (
              <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mt-1">
                Next close {formatBusinessHoursTimestamp(status.nextCloseAt, status.timezone)}
              </p>
            )}
          </div>

          <div className="border border-black/20 dark:border-white/20 p-4">
            <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-1">Draft preview</p>
            <p className="text-sm font-bold">{getBusinessHoursSummary(draftStatus)}</p>
            {getBusinessHoursReason(draftStatus) && (
              <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mt-2">
                {getBusinessHoursReason(draftStatus)}
              </p>
            )}
            {draftStatus.nextOpenAt && (
              <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mt-2">
                Next open {formatBusinessHoursTimestamp(draftStatus.nextOpenAt, draftStatus.timezone)}
              </p>
            )}
            {draftStatus.nextCloseAt && (
              <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mt-1">
                Next close {formatBusinessHoursTimestamp(draftStatus.nextCloseAt, draftStatus.timezone)}
              </p>
            )}
          </div>
        </div>

        <div className="border-2 border-black dark:border-white overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-black dark:border-white bg-black/5 dark:bg-white/5">
                <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">Day</th>
                <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">Closed</th>
                <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">Windows</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/20 dark:divide-white/20">
              {BUSINESS_HOURS_DAY_ORDER.map((day) => {
                const daySchedule = schedule.weekly[day];
                return (
                  <tr key={day}>
                    <td className="px-4 py-4 text-sm font-black uppercase tracking-widest">{BUSINESS_HOURS_DAY_LABELS[day]}</td>
                    <td className="px-4 py-4">
                      <button
                        onClick={() => updateDay(day, (next) => {
                          next.weekly[day].closed = !next.weekly[day].closed;
                          if (next.weekly[day].closed) next.weekly[day].windows = [];
                          if (!next.weekly[day].closed && next.weekly[day].windows.length === 0) {
                            next.weekly[day].windows = [{ start: '07:30', end: '22:30' }];
                          }
                        })}
                        className={`px-3 py-2 border-2 text-[10px] font-black uppercase tracking-widest ${
                          daySchedule.closed
                            ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white'
                            : 'border-black/20 dark:border-white/20'
                        }`}
                      >
                        {daySchedule.closed ? 'Closed' : 'Open'}
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      {daySchedule.closed ? (
                        <span className="text-xs font-bold uppercase opacity-50 tracking-widest">No intake windows</span>
                      ) : (
                        <div className="space-y-3">
                          {daySchedule.windows.map((window, index) => (
                            <div key={`${day}-${index}`} className="flex items-center gap-3">
                              <input
                                type="time"
                                value={window.start}
                                onChange={(e) => updateDay(day, (next) => {
                                  next.weekly[day].windows[index].start = e.target.value;
                                })}
                                className="border-2 border-black dark:border-white bg-transparent px-3 py-2 text-sm font-bold outline-none"
                              />
                              <span className="text-xs font-black uppercase tracking-widest opacity-60">to</span>
                              <input
                                type="time"
                                value={window.end}
                                onChange={(e) => updateDay(day, (next) => {
                                  next.weekly[day].windows[index].end = e.target.value;
                                })}
                                className="border-2 border-black dark:border-white bg-transparent px-3 py-2 text-sm font-bold outline-none"
                              />
                              <button
                                onClick={() => updateDay(day, (next) => {
                                  next.weekly[day].windows.splice(index, 1);
                                  if (next.weekly[day].windows.length === 0) {
                                    next.weekly[day].closed = true;
                                  }
                                })}
                                className="px-3 py-2 border-2 border-black dark:border-white text-[10px] font-black uppercase tracking-widest"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => updateDay(day, (next) => {
                              next.weekly[day].windows.push({ start: '07:30', end: '22:30' });
                            })}
                            className="px-3 py-2 border border-black dark:border-white text-[10px] font-black uppercase tracking-widest"
                          >
                            Add Window
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

        <div className="border-2 border-black dark:border-white overflow-hidden">
          <div className="px-4 py-3 border-b-2 border-black dark:border-white bg-black/5 dark:bg-white/5 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest">Exceptions</p>
              <p className="text-xs font-bold opacity-60 mt-1">Holiday closures and one-off overrides.</p>
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
              className="px-3 py-2 border-2 border-black dark:border-white text-[10px] font-black uppercase tracking-widest"
            >
              Add Exception
            </button>
          </div>

          <div className="p-4 space-y-4">
            {schedule.exceptions.length === 0 ? (
              <p className="text-xs font-bold uppercase tracking-widest opacity-50">No exceptions configured.</p>
            ) : (
              sortBusinessHoursExceptions(schedule.exceptions).map((exception) => {
                const index = schedule.exceptions.findIndex((item) => item.id === exception.id);
                return (
                <div key={exception.id} className="border border-black/20 dark:border-white/20 p-4 space-y-3">
                  <div className="grid grid-cols-[180px_140px_1fr_auto] gap-3 items-end">
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest mb-2">Date</label>
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
                        className="w-full border-2 border-black dark:border-white bg-transparent px-3 py-2 text-sm font-bold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest mb-2">Mode</label>
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
                        className={`w-full px-3 py-2 border-2 text-[10px] font-black uppercase tracking-widest ${
                          exception.closed
                            ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white'
                            : 'border-black/20 dark:border-white/20'
                        }`}
                      >
                        {exception.closed ? 'Closed' : 'Custom Hours'}
                      </button>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest mb-2">Note</label>
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
                        className="w-full border-2 border-black dark:border-white bg-transparent px-3 py-2 text-sm font-bold outline-none"
                        placeholder="Holiday / maintenance / event"
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
                      className="px-3 py-2 border-2 border-black dark:border-white text-[10px] font-black uppercase tracking-widest"
                    >
                      Remove
                    </button>
                  </div>

                  {exception.note?.trim() && (
                    <p className="text-[10px] font-black uppercase tracking-widest opacity-60">
                      Current note: {exception.note.trim()}
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
                            className="border-2 border-black dark:border-white bg-transparent px-3 py-2 text-sm font-bold outline-none"
                          />
                          <span className="text-xs font-black uppercase tracking-widest opacity-60">to</span>
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
                            className="border-2 border-black dark:border-white bg-transparent px-3 py-2 text-sm font-bold outline-none"
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
                            className="px-3 py-2 border border-black dark:border-white text-[10px] font-black uppercase tracking-widest"
                          >
                            Remove Window
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
                        className="px-3 py-2 border border-black dark:border-white text-[10px] font-black uppercase tracking-widest"
                      >
                        Add Window
                      </button>
                    </div>
                  )}
                </div>
              )})
            )}
          </div>
        </div>
      </div>

      <div className="border border-black/20 dark:border-white/20 p-4">
        <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-1">How it works</p>
        <p className="text-xs opacity-60 leading-relaxed">
          Agents can create new tickets only during the configured intake windows. Support staff can continue handling existing conversations outside those windows.
        </p>
      </div>
    </div>
  );
}

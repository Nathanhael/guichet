import { useState, useEffect } from 'react';
import { trpc } from '../../utils/trpc';

const TIMEZONES = [
  'Europe/Brussels', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Amsterdam', 'Europe/Madrid', 'Europe/Rome', 'Europe/Zurich',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney',
];

export default function AdminBusinessHours() {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [timezone, setTimezone] = useState('Europe/Brussels');
  const [isDirty, setIsDirty] = useState(false);

  const { data: manifest, isLoading, refetch } = trpc.partner.getManifest.useQuery();
  const mutation = trpc.partner.updateBusinessHours.useMutation({
    onSuccess: () => { setIsDirty(false); refetch(); },
  });

  useEffect(() => {
    if (manifest) {
      setStart(manifest.businessHoursStart || '');
      setEnd(manifest.businessHoursEnd || '');
      setTimezone(manifest.businessHoursTimezone || 'Europe/Brussels');
    }
  }, [manifest]);

  if (isLoading) return <div className="p-8 text-xs font-black uppercase tracking-widest opacity-50">Loading...</div>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-end justify-between border-b-4 border-black dark:border-white pb-4">
        <div>
          <h2 className="text-4xl font-black uppercase tracking-tighter">Business Hours</h2>
          <p className="text-sm font-bold uppercase opacity-60 mt-1 tracking-widest">Configure when agents can create new tickets.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setStart(''); setEnd(''); setTimezone('Europe/Brussels'); setIsDirty(true); }}
            className="px-4 py-2 border-2 border-black dark:border-white text-[10px] font-black uppercase tracking-widest"
          >
            Reset
          </button>
          <button
            disabled={!isDirty || mutation.isPending}
            onClick={() => mutation.mutate({ businessHoursStart: start || null, businessHoursEnd: end || null, businessHoursTimezone: timezone || null })}
            className="px-6 py-2 bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white text-[10px] font-black uppercase tracking-widest disabled:opacity-30"
          >
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="border-2 border-black dark:border-white p-6 space-y-6">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-2">Opens At</label>
            <input
              type="time"
              value={start}
              onChange={(e) => { setStart(e.target.value); setIsDirty(true); }}
              className="w-full bg-transparent border-2 border-black dark:border-white px-4 py-2 text-sm font-bold outline-none"
            />
            {!start && <p className="text-[10px] opacity-50 mt-1">Default: 07:30</p>}
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-2">Closes At</label>
            <input
              type="time"
              value={end}
              onChange={(e) => { setEnd(e.target.value); setIsDirty(true); }}
              className="w-full bg-transparent border-2 border-black dark:border-white px-4 py-2 text-sm font-bold outline-none"
            />
            {!end && <p className="text-[10px] opacity-50 mt-1">Default: 22:30</p>}
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest mb-2">Timezone</label>
          <select
            value={timezone}
            onChange={(e) => { setTimezone(e.target.value); setIsDirty(true); }}
            className="w-full bg-transparent border-2 border-black dark:border-white px-4 py-2 text-sm font-bold outline-none"
          >
            {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </div>
      </div>

      <div className="border border-black/20 dark:border-white/20 p-4">
        <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-1">How it works</p>
        <p className="text-xs opacity-60 leading-relaxed">
          Agents cannot create tickets outside business hours. Support staff can work on existing tickets at any time.
          Leave both times empty to use system defaults (07:30–22:30 Brussels time).
        </p>
      </div>
    </div>
  );
}

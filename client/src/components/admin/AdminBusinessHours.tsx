import { useState, useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import { Panel, Skeleton } from './DashboardHelpers';
import { Save, Clock, Globe, RotateCcw } from 'lucide-react';

const TIMEZONES = [
  'Europe/Brussels',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Zurich',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
];

export default function AdminBusinessHours() {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [timezone, setTimezone] = useState('Europe/Brussels');
  const [isDirty, setIsDirty] = useState(false);

  const { data: manifest, isLoading, refetch } = trpc.partner.getManifest.useQuery();

  const mutation = trpc.partner.updateBusinessHours.useMutation({
    onSuccess: () => {
      setIsDirty(false);
      refetch();
    },
  });

  useEffect(() => {
    if (manifest) {
      setStart(manifest.businessHoursStart || '');
      setEnd(manifest.businessHoursEnd || '');
      setTimezone(manifest.businessHoursTimezone || 'Europe/Brussels');
    }
  }, [manifest]);

  const handleSave = () => {
    mutation.mutate({
      businessHoursStart: start || null,
      businessHoursEnd: end || null,
      businessHoursTimezone: timezone || null,
    });
  };

  const handleReset = () => {
    setStart('');
    setEnd('');
    setTimezone('Europe/Brussels');
    setIsDirty(true);
  };

  if (isLoading) return <div className="p-6"><Skeleton className="h-64 w-full rounded-3xl" /></div>;

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-solarized-base01 dark:text-white tracking-tight flex items-center gap-2">
            <Clock className="text-accent-500" />
            Business Hours
          </h2>
          <p className="text-sm text-solarized-base1 dark:text-gray-400 mt-1">
            Configure when agents can create new tickets. Leave empty to use system defaults.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm text-gray-400 hover:text-white hover:bg-white/10 transition-all"
            title="Reset to system defaults"
          >
            <RotateCcw size={16} />
            Defaults
          </button>
          <button
            disabled={!isDirty || mutation.isPending}
            onClick={handleSave}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold transition-all ${
              isDirty
                ? 'bg-accent-500 text-white shadow-lg shadow-accent-500/20 hover:-translate-y-0.5'
                : 'bg-gray-200 dark:bg-brand-800 text-gray-400 cursor-not-allowed'
            }`}
          >
            <Save size={18} />
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <Panel title="Opening Hours">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-black uppercase tracking-widest text-gray-500 mb-2">
              Opens at
            </label>
            <input
              type="time"
              value={start}
              onChange={(e) => { setStart(e.target.value); setIsDirty(true); }}
              className="w-full bg-solarized-base3/50 dark:bg-black/20 border-2 border-solarized-base2 dark:border-brand-700 rounded-2xl px-5 py-3 text-sm font-medium focus:border-accent-500 outline-none transition-all"
              placeholder="07:30"
            />
            {!start && (
              <p className="text-[10px] text-gray-500 mt-1 italic">Default: 07:30</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-black uppercase tracking-widest text-gray-500 mb-2">
              Closes at
            </label>
            <input
              type="time"
              value={end}
              onChange={(e) => { setEnd(e.target.value); setIsDirty(true); }}
              className="w-full bg-solarized-base3/50 dark:bg-black/20 border-2 border-solarized-base2 dark:border-brand-700 rounded-2xl px-5 py-3 text-sm font-medium focus:border-accent-500 outline-none transition-all"
              placeholder="22:30"
            />
            {!end && (
              <p className="text-[10px] text-gray-500 mt-1 italic">Default: 22:30</p>
            )}
          </div>
        </div>
      </Panel>

      <Panel title="Timezone">
        <div className="flex items-center gap-3 mb-3">
          <Globe size={18} className="text-blue-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
            All times are evaluated in this timezone
          </span>
        </div>
        <select
          value={timezone}
          onChange={(e) => { setTimezone(e.target.value); setIsDirty(true); }}
          className="w-full bg-solarized-base3/50 dark:bg-black/20 border-2 border-solarized-base2 dark:border-brand-700 rounded-2xl px-5 py-3 text-sm font-medium focus:border-accent-500 outline-none transition-all"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
      </Panel>

      <div className="bg-accent-500/5 border border-accent-500/20 rounded-3xl p-6">
        <h3 className="text-sm font-bold text-accent-400 flex items-center gap-2 mb-2">
          <Clock size={16} />
          How it works
        </h3>
        <p className="text-xs text-gray-400 leading-relaxed">
          When an agent tries to create a ticket outside of business hours, they see a friendly closed message
          instead of the ticket form. Support specialists can still work on existing tickets at any time.
          Setting both times to empty resets to system defaults (07:30–22:30 Brussels time).
        </p>
      </div>
    </div>
  );
}

/**
 * Timezone utilities — full IANA list with offset display, region grouping, and auto-detect.
 */

// Intl.supportedValuesOf is not yet in TypeScript's lib types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const IntlAny = Intl as any;

export interface TimezoneEntry {
  id: string;
  label: string;        // e.g. "(UTC+01:00) Europe/Brussels"
  offset: number;       // minutes from UTC (for sorting)
  region: string;       // e.g. "Europe", "America", "Asia"
}

/** Get current UTC offset string for a timezone, e.g. "+01:00" or "-05:00" */
function getUtcOffset(tz: string): { display: string; minutes: number } {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    });
    const parts = formatter.formatToParts(now);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    const raw = tzPart?.value || 'GMT';

    // Parse "GMT+1", "GMT-5:30", "GMT" etc.
    if (raw === 'GMT' || raw === 'UTC') return { display: '+00:00', minutes: 0 };

    const match = raw.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!match) return { display: '+00:00', minutes: 0 };

    const sign = match[1];
    const hours = parseInt(match[2], 10);
    const mins = parseInt(match[3] || '0', 10);
    const totalMinutes = (hours * 60 + mins) * (sign === '-' ? -1 : 1);
    const display = `${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

    return { display, minutes: totalMinutes };
  } catch {
    return { display: '+00:00', minutes: 0 };
  }
}

/** Extract region from IANA timezone ID (e.g. "Europe" from "Europe/Brussels") */
function getRegion(tz: string): string {
  const slash = tz.indexOf('/');
  return slash > 0 ? tz.substring(0, slash) : 'Other';
}

/** Build the full timezone list from the browser's IANA database */
function buildTimezoneList(): TimezoneEntry[] {
  let allTimezones: string[];
  try {
    allTimezones = IntlAny.supportedValuesOf('timeZone');
  } catch {
    // Fallback for older browsers
    allTimezones = FALLBACK_TIMEZONES;
  }

  return allTimezones
    .map((tz) => {
      const { display, minutes } = getUtcOffset(tz);
      return {
        id: tz,
        label: `(UTC${display}) ${tz.replace(/_/g, ' ')}`,
        offset: minutes,
        region: getRegion(tz),
      };
    })
    .sort((a, b) => a.offset - b.offset || a.id.localeCompare(b.id));
}

// Cache the list — offsets can change with DST but rebuilding per render is wasteful.
// Rebuild every hour for DST accuracy.
let _cache: { entries: TimezoneEntry[]; builtAt: number } | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export function getTimezones(): TimezoneEntry[] {
  const now = Date.now();
  if (_cache && now - _cache.builtAt < CACHE_TTL) return _cache.entries;
  const entries = buildTimezoneList();
  _cache = { entries, builtAt: now };
  return entries;
}

/** Detect the user's current timezone */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/** Region display order */
export const REGION_ORDER = [
  'Europe', 'America', 'Asia', 'Africa', 'Australia', 'Pacific', 'Indian', 'Atlantic', 'Antarctica',
];

/** Group timezones by region */
export function groupByRegion(entries: TimezoneEntry[]): Map<string, TimezoneEntry[]> {
  const groups = new Map<string, TimezoneEntry[]>();
  for (const region of REGION_ORDER) {
    groups.set(region, []);
  }
  for (const entry of entries) {
    const list = groups.get(entry.region);
    if (list) {
      list.push(entry);
    } else {
      // Unknown region — append to end
      if (!groups.has(entry.region)) groups.set(entry.region, []);
      groups.get(entry.region)!.push(entry);
    }
  }
  // Remove empty groups
  for (const [key, val] of groups) {
    if (val.length === 0) groups.delete(key);
  }
  return groups;
}

/** Fallback for browsers without Intl.supportedValuesOf */
const FALLBACK_TIMEZONES = [
  'Europe/Brussels', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Amsterdam', 'Europe/Madrid', 'Europe/Rome', 'Europe/Zurich',
  'Europe/Athens', 'Europe/Helsinki', 'Europe/Istanbul', 'Europe/Lisbon',
  'Europe/Moscow', 'Europe/Warsaw',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Anchorage', 'America/Toronto', 'America/Vancouver', 'America/Mexico_City',
  'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'America/Bogota',
  'Asia/Dubai', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Bahrain', 'Asia/Kuwait',
  'Asia/Jerusalem', 'Asia/Tehran',
  'Asia/Kolkata', 'Asia/Colombo', 'Asia/Dhaka', 'Asia/Karachi',
  'Asia/Bangkok', 'Asia/Singapore', 'Asia/Jakarta', 'Asia/Manila',
  'Asia/Kuala_Lumpur', 'Asia/Ho_Chi_Minh',
  'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Seoul', 'Asia/Taipei',
  'Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth',
  'Pacific/Auckland', 'Pacific/Honolulu',
  'Africa/Cairo', 'Africa/Lagos', 'Africa/Johannesburg', 'Africa/Nairobi',
  'Africa/Casablanca',
];

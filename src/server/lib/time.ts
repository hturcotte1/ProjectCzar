import { DateTime, IANAZone } from 'luxon';

/** All stored times are ISO-8601 strings in UTC, e.g. "2026-10-03T20:15:00.000Z". */
export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function ms(isoString: string): number {
  return new Date(isoString).getTime();
}

export function isValidTimezone(tz: string): boolean {
  return IANAZone.isValidZone(tz);
}

/** "Friday 2:15 pm Mountain Time" */
export function plainTime(atMs: number, tz: string): string {
  const dt = DateTime.fromMillis(atMs, { zone: tz });
  const day = dt.toFormat('cccc');
  const time = dt.toFormat('h:mm a').toLowerCase();
  return `${day} ${time} ${zoneLongName(atMs, tz)}`;
}

/** "Oct 3, 2:15 pm" — compact form for lists. */
export function shortTime(atMs: number, tz: string): string {
  const dt = DateTime.fromMillis(atMs, { zone: tz });
  return `${dt.toFormat('LLL d')}, ${dt.toFormat('h:mm a').toLowerCase()}`;
}

/** "Mountain Time" (generic, no daylight/standard), falling back to the IANA name. */
export function zoneLongName(atMs: number, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(
      new Date(atMs),
    );
    const name = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (name) return name;
  } catch {
    /* fall through */
  }
  return tz;
}

/** "8:00 am" from "08:00" */
export function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const dt = DateTime.fromObject({ hour: h, minute: m });
  return dt.toFormat('h:mm a').toLowerCase();
}

export function parseHHMM(hhmm: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) return null;
  return { hour, minute };
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "Monday to Friday", "every day", "Monday, Wednesday and Friday" */
export function daysLabel(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return 'every day';
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (contiguous && sorted.length >= 3) return `${DAY_NAMES[sorted[0] - 1]} to ${DAY_NAMES[sorted[sorted.length - 1] - 1]}`;
  const names = sorted.map((d) => DAY_NAMES[d - 1]);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function parseDays(s: string): number[] {
  return s
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
}

/** "in 12 minutes", "2 hours ago" */
export function relative(fromMs: number, toMs: number): string {
  const diff = toMs - fromMs;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  let s: string;
  if (mins < 1) s = 'less than a minute';
  else if (mins < 60) s = `${mins} minute${mins === 1 ? '' : 's'}`;
  else if (mins < 60 * 48) {
    const h = Math.round(mins / 60);
    s = `${h} hour${h === 1 ? '' : 's'}`;
  } else {
    const d = Math.round(mins / 1440);
    s = `${d} day${d === 1 ? '' : 's'}`;
  }
  return diff >= 0 ? `in ${s}` : `${s} ago`;
}

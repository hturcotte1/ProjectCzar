/** Times are stored in UTC and shown in the viewer's own time zone. */

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const fullFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "2:15 PM", "Yesterday 2:15 PM", "Fri, Oct 3 2:15 PM" */
export function when(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400_000);
  if (sameDay(d, now)) return timeFmt.format(d);
  if (sameDay(d, yesterday)) return `Yesterday ${timeFmt.format(d)}`;
  return `${dayFmt.format(d)} ${timeFmt.format(d)}`;
}

/** Full date and time with the viewer's time zone, for tooltips. */
export function fullTime(iso: string | null | undefined): string {
  return iso ? fullFmt.format(new Date(iso)) : '';
}

/** "in 12 min", "3 h ago", "just now" */
export function relative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60_000);
  let s: string;
  if (min < 1) return diff >= 0 ? 'in under a minute' : 'just now';
  if (min < 60) s = `${min} min`;
  else if (min < 48 * 60) s = `${Math.round(min / 60)} h`;
  else s = `${Math.round(min / 1440)} days`;
  return diff >= 0 ? `in ${s}` : `${s} ago`;
}

export function money(usd: number): string {
  return `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(0)}`;
}

export function percent(x: number | null): string {
  return x === null ? '—' : `${Math.round(x * 100)}%`;
}

export const LIGHT_WORDS: Record<string, string> = {
  green: 'On time',
  amber: 'Late',
  red: 'Missed check-ins',
  gray: 'Off / not connected',
};

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

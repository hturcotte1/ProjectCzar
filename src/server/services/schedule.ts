import { DateTime } from 'luxon';
import { clockLabel, daysLabel, parseDays, parseHHMM, plainTime, relative, zoneLongName } from '../lib/time.js';

/**
 * Check-in schedules and status lights.
 *
 * A schedule produces "slots": the times a check-in is expected. For a normal agent the slots are
 * wall-clock times in the agent's own time zone, on working days, from work_start + offset every
 * interval until work_end (inclusive). Daylight saving is handled by luxon, which builds each slot
 * from its wall-clock time.
 *
 * Stand-in agents in a sandbox room run on a sped-up clock (clock_speed > 1): their slots form a
 * continuous grid with every duration divided by the speed, and working hours are ignored.
 *
 * A completed check-in at time c satisfies every slot up to c + interval/2, so an agent that
 * checks in a little early or late, or on a steady cadence that is not aligned to our grid,
 * stays green.
 */
export interface Schedule {
  intervalMinutes: number;
  workDays: number[]; // ISO weekdays, 1 = Monday
  workStart: string; // "08:00"
  workEnd: string; // "18:00"
  timezone: string;
  offsetMinutes: number;
  graceMinutes: number;
  clockSpeed: number;
}

export interface AgentScheduleRow {
  interval_minutes: number;
  work_days: string;
  work_start: string;
  work_end: string;
  timezone: string;
  offset_minutes: number;
  grace_minutes: number;
  clock_speed: number;
}

export function scheduleFromRow(row: AgentScheduleRow): Schedule {
  return {
    intervalMinutes: row.interval_minutes,
    workDays: parseDays(row.work_days),
    workStart: row.work_start,
    workEnd: row.work_end,
    timezone: row.timezone,
    offsetMinutes: row.offset_minutes,
    graceMinutes: row.grace_minutes,
    clockSpeed: row.clock_speed > 0 ? row.clock_speed : 1,
  };
}

const MIN = 60_000;

function toMinutes(hhmm: string): number {
  const p = parseHHMM(hhmm);
  return p ? p.hour * 60 + p.minute : 0;
}

/** Real milliseconds for a schedule duration given in minutes (sped up in a sandbox). */
export function scaled(s: Schedule, minutes: number): number {
  return (minutes * MIN) / s.clockSpeed;
}

function isSped(s: Schedule): boolean {
  return s.clockSpeed > 1;
}

// Each day's slots are computed once per schedule and reused (time zone math is the slow part).
const slotCache = new Map<string, readonly number[]>();
const SLOT_CACHE_MAX = 5000;

/** Slot times (ms) on the local calendar day containing `dayStart`. The result must not be changed. */
function slotsForDay(s: Schedule, day: DateTime): readonly number[] {
  if (!s.workDays.includes(day.weekday)) return [];
  const key = `${s.timezone}|${s.intervalMinutes}|${s.offsetMinutes}|${s.workStart}|${s.workEnd}|${day.year}-${day.month}-${day.day}`;
  const hit = slotCache.get(key);
  if (hit) return hit;
  const out = computeSlotsForDay(s, day);
  if (slotCache.size >= SLOT_CACHE_MAX) slotCache.clear();
  slotCache.set(key, out);
  return out;
}

function computeSlotsForDay(s: Schedule, day: DateTime): number[] {
  const start = toMinutes(s.workStart);
  const end = toMinutes(s.workEnd);
  const out: number[] = [];
  const interval = Math.max(1, s.intervalMinutes);
  for (let m = start + (s.offsetMinutes % interval); m <= end; m += interval) {
    const dt = DateTime.fromObject(
      { year: day.year, month: day.month, day: day.day, hour: Math.floor(m / 60), minute: m % 60 },
      { zone: s.timezone },
    );
    if (dt.isValid) out.push(dt.toMillis());
  }
  return out;
}

/** The first slot strictly after `t`, or null if none in the next 15 days. */
export function firstSlotAfter(s: Schedule, t: number): number | null {
  if (isSped(s)) {
    const step = scaled(s, Math.max(1, s.intervalMinutes));
    const anchor = scaled(s, s.offsetMinutes % Math.max(1, s.intervalMinutes));
    const k = Math.floor((t - anchor) / step) + 1;
    return anchor + k * step;
  }
  let day = DateTime.fromMillis(t, { zone: s.timezone }).startOf('day');
  for (let i = 0; i < 15; i++) {
    for (const slot of slotsForDay(s, day)) {
      if (slot > t) return slot;
    }
    day = day.plus({ days: 1 });
  }
  return null;
}

/** Every slot after `from` and up to `to`, in order (at most `max`). One pass over the days. */
export function slotsBetween(s: Schedule, from: number, to: number, max = 5000): number[] {
  const out: number[] = [];
  if (isSped(s)) {
    for (let slot = firstSlotAfter(s, from); slot !== null && slot <= to && out.length < max; slot = firstSlotAfter(s, slot)) out.push(slot);
    return out;
  }
  let day = DateTime.fromMillis(from, { zone: s.timezone }).startOf('day');
  while (day.toMillis() <= to && out.length < max) {
    for (const slot of slotsForDay(s, day)) {
      if (slot > from && slot <= to && out.length < max) out.push(slot);
    }
    day = day.plus({ days: 1 });
  }
  return out;
}

/** The next slot an agent owes, given its last completed check-in (or first contact). */
export function nextDueAfterCheckin(s: Schedule, lastCheckinMs: number): number | null {
  return firstSlotAfter(s, lastCheckinMs + scaled(s, s.intervalMinutes) / 2);
}

export function isWorkingTime(s: Schedule, t: number): boolean {
  if (isSped(s)) return true;
  const dt = DateTime.fromMillis(t, { zone: s.timezone });
  if (!s.workDays.includes(dt.weekday)) return false;
  const m = dt.hour * 60 + dt.minute;
  return m >= toMinutes(s.workStart) && m <= toMinutes(s.workEnd) + s.graceMinutes;
}

export type Light = 'green' | 'amber' | 'red' | 'gray';

export interface StatusInput {
  schedule: Schedule;
  now: number;
  paused: boolean;
  inAnyRoom: boolean;
  firstSeenMs: number | null;
  lastCheckinMs: number | null;
  /** Issue time of the newest card that has not been reported on, if it is newer than the last check-in. */
  openCardIssuedMs: number | null;
  cardTimeoutMinutes: number;
}

export interface StatusResult {
  light: Light;
  reason: string;
  /** Short machine-readable reason: paused, no_rooms, never_connected, off_hours, on_time, late, missed, card_open. */
  code: string;
  nextDueMs: number | null;
  /** True when a card was opened but not reported: often an approval prompt waiting for a tap. */
  cardOpenNoReport: boolean;
}

export function computeStatus(i: StatusInput): StatusResult {
  const s = i.schedule;
  const cardOpenNoReport =
    i.openCardIssuedMs !== null && i.now - i.openCardIssuedMs >= scaled(s, i.cardTimeoutMinutes);
  const baseline = i.lastCheckinMs ?? i.firstSeenMs;
  const nextDue = baseline !== null ? nextDueAfterCheckin(s, baseline) : firstSlotAfter(s, i.now);
  const tz = s.timezone;

  if (i.paused) return { light: 'gray', code: 'paused', reason: 'Paused.', nextDueMs: null, cardOpenNoReport: false };
  if (!i.inAnyRoom)
    return { light: 'gray', code: 'no_rooms', reason: 'Not in any room yet.', nextDueMs: null, cardOpenNoReport: false };
  if (baseline === null)
    return {
      light: 'gray',
      code: 'never_connected',
      reason: 'Has never connected.',
      nextDueMs: firstSlotAfter(s, i.now),
      cardOpenNoReport: false,
    };

  const grace = scaled(s, s.graceMinutes);
  let missed = 0;
  let firstMissed: number | null = null;
  if (nextDue !== null && i.now >= nextDue + grace) {
    missed = 1;
    firstMissed = nextDue;
    const second = firstSlotAfter(s, nextDue);
    if (second !== null && i.now >= second + grace) missed = 2;
  }

  if (!isWorkingTime(s, i.now)) {
    return {
      light: 'gray',
      code: 'off_hours',
      reason: 'Outside working hours.',
      nextDueMs: nextDue !== null && nextDue > i.now ? nextDue : firstSlotAfter(s, i.now),
      cardOpenNoReport,
    };
  }

  if (missed >= 2) {
    const last = i.lastCheckinMs !== null ? `last check-in ${relative(i.now, i.lastCheckinMs)}` : 'no check-in yet';
    return {
      light: 'red',
      code: 'missed',
      reason: `Missed two check-ins (${last}).${cardOpenNoReport ? ' A card was opened but no report came back.' : ''}`,
      nextDueMs: nextDue,
      cardOpenNoReport,
    };
  }
  if (missed === 1 && firstMissed !== null) {
    return {
      light: 'amber',
      code: 'late',
      reason: `Late: a check-in was due ${plainTime(firstMissed, tz)}.`,
      nextDueMs: nextDue,
      cardOpenNoReport,
    };
  }
  if (cardOpenNoReport && i.openCardIssuedMs !== null) {
    return {
      light: 'amber',
      code: 'card_open',
      reason: `Opened a card ${relative(i.now, i.openCardIssuedMs)} but has not reported.`,
      nextDueMs: nextDue,
      cardOpenNoReport,
    };
  }
  return { light: 'green', code: 'on_time', reason: 'On time.', nextDueMs: nextDue, cardOpenNoReport: false };
}

/** "every 60 minutes from 8:00 am to 6:00 pm, Monday to Friday, Mountain Time (at :00 past the hour)" */
export function describeSchedule(s: Schedule, atMs: number): string {
  if (isSped(s)) {
    const secs = Math.round((s.intervalMinutes * 60) / s.clockSpeed);
    return `every ${secs} seconds (rehearsal speed), around the clock`;
  }
  const interval =
    s.intervalMinutes % 60 === 0 && s.intervalMinutes >= 60
      ? s.intervalMinutes === 60
        ? 'every hour'
        : `every ${s.intervalMinutes / 60} hours`
      : `every ${s.intervalMinutes} minutes`;
  const startMin = toMinutes(s.workStart) + (s.offsetMinutes % Math.max(1, s.intervalMinutes));
  const first = `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`;
  const tzName = zoneLongName(atMs, s.timezone);
  return `${interval} from ${clockLabel(first)} until ${clockLabel(s.workEnd)}, ${daysLabel(s.workDays)}, ${tzName}`;
}

/** Wall-clock list of today's slot times, e.g. ["8:00 am", "9:00 am", ...] (empty for a sped-up schedule). */
export function slotLabels(s: Schedule): string[] {
  if (isSped(s)) return [];
  const start = toMinutes(s.workStart);
  const end = toMinutes(s.workEnd);
  const out: string[] = [];
  const interval = Math.max(1, s.intervalMinutes);
  for (let m = start + (s.offsetMinutes % interval); m <= end; m += interval) {
    out.push(clockLabel(`${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`));
  }
  return out;
}

/**
 * Suggest a minute offset for a new agent so check-ins in a room are spread out:
 * with one other agent, half an interval apart.
 */
export function suggestOffset(existingOffsets: number[], intervalMinutes: number): number {
  const interval = Math.max(1, intervalMinutes);
  if (existingOffsets.length === 0) return 0;
  const taken = existingOffsets.map((o) => ((o % interval) + interval) % interval);
  let best = 0;
  let bestDist = -1;
  const step = interval >= 20 ? 5 : 1;
  for (let c = 0; c < interval; c += step) {
    const d = Math.min(...taken.map((t) => Math.min(Math.abs(c - t), interval - Math.abs(c - t))));
    if (d > bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

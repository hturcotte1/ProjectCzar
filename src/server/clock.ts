/**
 * The one source of "now" for all logic. Tests and the rehearsal inject their own.
 * Nothing in the service layer, scheduler or Conductor calls Date.now() directly.
 */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

/**
 * A clock that starts at a chosen moment and then moves forward in real time. Only the seeded
 * development and browser-test server uses it (`scripts/dev-server.ts --clock`), so the demo room
 * can be inside working hours whatever the real time of day. Live updates, the scheduler and
 * timeouts still work, because time keeps moving. The real server always uses `systemClock`.
 */
export function clockStartingAt(start: number | string | Date, real: Clock = systemClock): Clock {
  const startMs = typeof start === 'number' ? start : new Date(start).getTime();
  if (!Number.isFinite(startMs)) {
    throw new Error(`"${String(start)}" is not a date and time. Write it like 2026-10-07T16:00:00Z.`);
  }
  const offset = startMs - real.now();
  return { now: () => real.now() + offset };
}

export class FakeClock implements Clock {
  private t: number;
  constructor(start: number | string | Date = '2026-10-05T15:00:00.000Z') {
    this.t = typeof start === 'number' ? start : new Date(start).getTime();
  }
  now(): number {
    return this.t;
  }
  set(t: number | string | Date): void {
    this.t = typeof t === 'number' ? t : new Date(t).getTime();
  }
  advance(ms: number): void {
    this.t += ms;
  }
  advanceMinutes(min: number): void {
    this.t += min * 60_000;
  }
}

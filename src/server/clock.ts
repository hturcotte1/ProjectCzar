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

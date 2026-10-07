import { describe, expect, it } from 'vitest';
import { buildApp, createContext } from '../src/server/app.js';
import { FakeClock, clockStartingAt, type Clock } from '../src/server/clock.js';
import { openDatabase } from '../src/server/db/index.js';
import { seedDemo } from '../src/server/demo-seed.js';
import { getAgent } from '../src/server/services/repo.js';
import { computeAgentStatus } from '../src/server/services/status.js';
import { E2E_SERVER_START } from './e2e/server-clock.js';

/**
 * The browser tests' seeded server starts its clock at a fixed moment inside the demo room's
 * working hours and lets it move forward in real time (scripts/dev-server.ts --clock). Before this,
 * the tile test failed whenever it ran outside 8 am to 6 pm Boise time, Monday to Friday.
 */

/** 8:35 pm on a Wednesday in Boise: outside working hours, when the browser test used to fail. */
const WEDNESDAY_EVENING = '2026-10-08T02:35:00.000Z';

async function seededAt(clock: Clock) {
  const ctx = createContext({ db: openDatabase(':memory:'), clock, env: { NODE_ENV: 'test' }, config: { baseUrl: 'http://tempo.test' } });
  const seeded = await seedDemo(ctx);
  const museHenry = () => computeAgentStatus(ctx, getAgent(ctx.db, seeded.agents.find((a) => a.name === 'Muse Henry')!.id)!);
  return { ctx, museHenry };
}

describe('a clock that starts at a chosen moment', () => {
  it('starts there and then moves forward with real time', () => {
    const real = new FakeClock(WEDNESDAY_EVENING);
    const clock = clockStartingAt('2026-10-07T16:00:00Z', real);
    expect(new Date(clock.now()).toISOString()).toBe('2026-10-07T16:00:00.000Z');
    real.advance(1500);
    expect(new Date(clock.now()).toISOString()).toBe('2026-10-07T16:00:01.500Z');
    real.advanceMinutes(30);
    expect(new Date(clock.now()).toISOString()).toBe('2026-10-07T16:30:01.500Z');
  });

  it('accepts a number or a date as well as text', () => {
    const real = new FakeClock(WEDNESDAY_EVENING);
    expect(clockStartingAt(Date.parse('2026-10-07T16:00:00Z'), real).now()).toBe(Date.parse('2026-10-07T16:00:00Z'));
    expect(clockStartingAt(new Date('2026-10-07T16:00:00Z'), real).now()).toBe(Date.parse('2026-10-07T16:00:00Z'));
  });

  it('refuses a time it cannot read, in plain words', () => {
    expect(() => clockStartingAt('next Wednesday')).toThrow(/"next Wednesday" is not a date and time.*2026-10-07T16:00:00Z/);
  });

  it('uses the real clock when no other is given', () => {
    const clock = clockStartingAt('2026-10-07T16:00:00Z');
    const t = clock.now();
    expect(t).toBeGreaterThanOrEqual(Date.parse('2026-10-07T16:00:00Z'));
    expect(t).toBeLessThan(Date.parse('2026-10-07T16:00:05Z'));
  });
});

describe("the browser tests' seeded server", () => {
  it('shows the demo room inside working hours, even when the real time is not', async () => {
    const real = new FakeClock(WEDNESDAY_EVENING);
    // What the browser test saw on the real clock in the evening: the screen was right, the test wrong.
    expect((await seededAt(real)).museHenry().reason).toBe('Outside working hours.');

    const { ctx, museHenry } = await seededAt(clockStartingAt(E2E_SERVER_START, real));
    expect(museHenry()).toMatchObject({ light: 'green', reason: 'On time.' });
    // Still on time after a whole browser test run's worth of real time.
    real.advanceMinutes(5);
    expect(museHenry()).toMatchObject({ light: 'green', reason: 'On time.' });
    // The server reports this time, so the browser tests can set the browser's clock to match.
    const { app } = await buildApp({}, ctx);
    const health = (await app.inject({ method: 'GET', url: '/healthz' })).json() as { time: string };
    expect(health.time).toBe('2026-10-07T16:05:00.000Z');
    await app.close();
  });

  it('starts on a weekday in Boise working hours, with more than an hour of them left', () => {
    const boise = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Boise', weekday: 'long', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(E2E_SERVER_START));
    const hour = Number(boise.find((p) => p.type === 'hour')!.value);
    const weekday = boise.find((p) => p.type === 'weekday')!.value;
    expect(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']).toContain(weekday);
    expect(hour).toBeGreaterThanOrEqual(8);
    expect(hour).toBeLessThan(17);
  });
});

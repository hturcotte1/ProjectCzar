import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { checkIn, count, fullReport, makeWorld, report } from './helpers.js';
import { Scheduler } from '../src/server/scheduler/index.js';
import { computeStatus, firstSlotAfter, nextDueAfterCheckin, scheduleFromRow, suggestOffset, type Schedule } from '../src/server/services/schedule.js';
import { setRoomPaused } from '../src/server/services/manage.js';
import { createContext } from '../src/server/app.js';
import { FakeClock } from '../src/server/clock.js';
import { openDatabase } from '../src/server/db/index.js';
import { createAgent, createPersonRecord, createRoom } from '../src/server/services/manage.js';

const boise: Schedule = {
  intervalMinutes: 60,
  workDays: [1, 2, 3, 4, 5],
  workStart: '08:00',
  workEnd: '18:00',
  timezone: 'America/Boise',
  offsetMinutes: 0,
  graceMinutes: 15,
  clockSpeed: 1,
};

const at = (local: string) => DateTime.fromISO(local, { zone: 'America/Boise' }).toMillis();

function agentRow(ctx: any, id: string) {
  return ctx.db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
}

describe('schedules', () => {
  it('produces slots in the agent time zone, across daylight saving', () => {
    // Friday Oct 30 2026, 5:30 pm MDT: next slot is 6:00 pm the same day.
    expect(firstSlotAfter(boise, at('2026-10-30T17:30'))).toBe(at('2026-10-30T18:00'));
    // After 6 pm Friday, the next slot is Monday 8:00 am, which is after DST ends (Nov 1): MST = UTC-7.
    const monday = firstSlotAfter(boise, at('2026-10-30T18:05'))!;
    expect(new Date(monday).toISOString()).toBe('2026-11-02T15:00:00.000Z');
    expect(new Date(at('2026-10-30T08:00')).toISOString()).toBe('2026-10-30T14:00:00.000Z');
  });

  it('a check-in covers slots up to half an interval after it', () => {
    expect(nextDueAfterCheckin(boise, at('2026-10-05T09:50'))).toBe(at('2026-10-05T11:00'));
    expect(nextDueAfterCheckin(boise, at('2026-10-05T09:20'))).toBe(at('2026-10-05T10:00'));
    expect(nextDueAfterCheckin(boise, at('2026-10-05T17:50'))).toBe(at('2026-10-06T08:00'));
  });

  it('honours the minute offset and suggests offsets half an interval apart', () => {
    expect(firstSlotAfter({ ...boise, offsetMinutes: 30 }, at('2026-10-05T08:10'))).toBe(at('2026-10-05T08:30'));
    expect(suggestOffset([], 60)).toBe(0);
    expect(suggestOffset([0], 60)).toBe(30);
    expect(suggestOffset([0, 30], 60)).toBe(15);
  });

  it('computes lights from timestamps alone', () => {
    const base = { schedule: boise, paused: false, inAnyRoom: true, firstSeenMs: at('2026-10-05T08:00'), openCardIssuedMs: null, cardTimeoutMinutes: 20 };
    const last = at('2026-10-05T09:00');
    expect(computeStatus({ ...base, now: at('2026-10-05T10:14'), lastCheckinMs: last }).light).toBe('green');
    expect(computeStatus({ ...base, now: at('2026-10-05T10:16'), lastCheckinMs: last }).light).toBe('amber');
    expect(computeStatus({ ...base, now: at('2026-10-05T11:16'), lastCheckinMs: last }).light).toBe('red');
    expect(computeStatus({ ...base, now: at('2026-10-05T19:30'), lastCheckinMs: last }).light).toBe('gray');
    expect(computeStatus({ ...base, now: at('2026-10-05T10:00'), lastCheckinMs: null, firstSeenMs: null }).code).toBe('never_connected');
    expect(computeStatus({ ...base, now: at('2026-10-05T11:16'), lastCheckinMs: last, paused: true }).light).toBe('gray');
    const open = computeStatus({ ...base, now: at('2026-10-05T09:31'), lastCheckinMs: last, openCardIssuedMs: at('2026-10-05T09:10') });
    expect(open.light).toBe('amber');
    expect(open.code).toBe('card_open');
    // A sped-up sandbox schedule: 45-minute interval at 60x is 45 real seconds, around the clock.
    const fast = { ...boise, intervalMinutes: 45, clockSpeed: 60, workDays: [1, 2, 3, 4, 5] };
    const t0 = at('2026-10-10T03:00'); // a Saturday night: ignored at sandbox speed
    expect(computeStatus({ ...base, schedule: fast, now: t0 + 30_000, lastCheckinMs: t0 }).light).toBe('green');
    expect(computeStatus({ ...base, schedule: fast, now: t0 + 90_000, lastCheckinMs: t0 }).light).toBe('amber');
    expect(computeStatus({ ...base, schedule: fast, now: t0 + 140_000, lastCheckinMs: t0 }).light).toBe('red');
  });
});

describe('status lights, incidents and alerts (fake clock)', () => {
  it('goes amber then red at the right times, alerts the owner once, and clears on recovery', async () => {
    const w = await makeWorld();
    const sched = new Scheduler(w.ctx);
    const card = (await checkIn(w, w.a.apiKey)).body; // Monday 9:00 am
    await report(w, w.a.apiKey, fullReport(card));
    await sched.tick();
    expect(agentRow(w.ctx, w.a.agent.id).status).toBe('green');

    w.clock.set(at('2026-10-05T10:14'));
    await sched.tick();
    expect(agentRow(w.ctx, w.a.agent.id).status).toBe('green');

    w.clock.set(at('2026-10-05T10:16'));
    await sched.tick();
    expect(agentRow(w.ctx, w.a.agent.id).status).toBe('amber');
    expect(count(w.ctx, "SELECT COUNT(*) n FROM feed_events WHERE kind = 'system' AND data LIKE '%agent_amber%'")).toBe(1);
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM alerts')).toBe(0);

    w.clock.set(at('2026-10-05T11:16'));
    await sched.tick();
    expect(agentRow(w.ctx, w.a.agent.id).status).toBe('red');
    const alerts = w.ctx.db.prepare("SELECT * FROM alerts WHERE kind = 'agent_red'").all() as any[];
    expect(alerts.length).toBe(1);
    expect(alerts[0].person_id).toBe(w.henry.id);
    expect(alerts[0].title).toBe('Tempo: Muse Henry has gone quiet (red)');
    expect(alerts[0].body).toContain('To re-arm it, send it this message');
    expect(alerts[0].body).toContain('Run a Tempo check-in: call tempo_check_in');
    // No project content in alert text.
    expect(alerts[0].body).not.toContain('launch page');
    expect(JSON.parse(alerts[0].deliveries).email).toBe('email not set up');

    // More ticks while red: still one alert.
    w.clock.set(at('2026-10-05T12:30'));
    await sched.tick();
    w.clock.set(at('2026-10-05T19:00')); // evening: gray, incident stays open
    await sched.tick();
    expect(agentRow(w.ctx, w.a.agent.id).status).toBe('gray');
    expect(count(w.ctx, "SELECT COUNT(*) n FROM alerts WHERE kind = 'agent_red'")).toBe(1);
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM incidents WHERE ended_at IS NULL')).toBe(1);

    // Recovery next morning.
    w.clock.set(at('2026-10-06T08:02'));
    const c2 = (await checkIn(w, w.a.apiKey)).body;
    await report(w, w.a.apiKey, fullReport(c2));
    await sched.tick();
    expect(agentRow(w.ctx, w.a.agent.id).status).toBe('green');
    expect(count(w.ctx, "SELECT COUNT(*) n FROM alerts WHERE kind = 'agent_recovered'")).toBe(1);
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM incidents WHERE ended_at IS NULL')).toBe(0);
    expect(count(w.ctx, "SELECT COUNT(*) n FROM feed_events WHERE data LIKE '%agent_recovered%'")).toBe(1);
  });

  it('a card opened without a report becomes an incomplete check-in, and the red alert hints at an approval prompt', async () => {
    const w = await makeWorld();
    const sched = new Scheduler(w.ctx);
    const c1 = (await checkIn(w, w.a.apiKey)).body;
    await report(w, w.a.apiKey, fullReport(c1)); // 9:00
    w.clock.set(at('2026-10-05T10:00'));
    await checkIn(w, w.a.apiKey); // opened, never reported
    w.clock.set(at('2026-10-05T10:21'));
    await sched.tick();
    expect(count(w.ctx, "SELECT COUNT(*) n FROM cards WHERE status = 'expired'")).toBe(1);
    expect(agentRow(w.ctx, w.a.agent.id).status).toBe('amber');
    expect(count(w.ctx, "SELECT COUNT(*) n FROM feed_events WHERE data LIKE '%checkin_incomplete%'")).toBe(1);
    w.clock.set(at('2026-10-05T11:16'));
    await sched.tick();
    const alert = w.ctx.db.prepare("SELECT body FROM alerts WHERE kind = 'agent_red'").get() as any;
    expect(alert.body).toContain('waiting for you to approve the Tempo connection');
  });

  it('pausing a room turns its agents gray and resuming brings them back', async () => {
    const w = await makeWorld();
    const sched = new Scheduler(w.ctx);
    const c1 = (await checkIn(w, w.a.apiKey)).body;
    await report(w, w.a.apiKey, fullReport(c1));
    setRoomPaused(w.ctx, { kind: 'person', id: w.henry.id, name: 'Henry' }, w.room.id, true);
    w.clock.set(at('2026-10-05T12:00'));
    await sched.tick();
    expect(agentRow(w.ctx, w.a.agent.id).status).toBe('gray');
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM alerts')).toBe(0);
    setRoomPaused(w.ctx, { kind: 'person', id: w.henry.id, name: 'Henry' }, w.room.id, false);
    await sched.tick();
    expect(agentRow(w.ctx, w.a.agent.id).status).toBe('red');
  });

  it('survives a restart: state comes from stored timestamps and alerts are not repeated', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-restart-'));
    const file = path.join(dir, 'tempo.db');
    const clock = new FakeClock(at('2026-10-05T09:00'));
    let ctx = createContext({ db: openDatabase(file), clock, env: { NODE_ENV: 'test' } });
    const owner = createPersonRecord(ctx, { name: 'Henry', email: 'h@example.com', passwordHash: 'x', role: 'admin' });
    const room = createRoom(ctx, owner, { name: 'Launch' });
    const agent = createAgent(ctx, owner, { name: 'Muse Henry', type: 'muse', room_ids: [room.id] });
    ctx.db.prepare('UPDATE agents SET first_seen_at = ?, last_checkin_at = ? WHERE id = ?').run('2026-10-05T15:00:00.000Z', '2026-10-05T15:00:00.000Z', agent.agent.id);
    clock.set(at('2026-10-05T11:20'));
    await new Scheduler(ctx).tick();
    expect(count(ctx, "SELECT COUNT(*) n FROM alerts WHERE kind = 'agent_red'")).toBe(1);
    ctx.db.close();

    // "Restart": a fresh process opens the same file.
    ctx = createContext({ db: openDatabase(file), clock, env: { NODE_ENV: 'test' } });
    clock.set(at('2026-10-05T11:40'));
    await new Scheduler(ctx).tick();
    expect(agentRow(ctx, agent.agent.id).status).toBe('red');
    expect(count(ctx, "SELECT COUNT(*) n FROM alerts WHERE kind = 'agent_red'")).toBe(1);
    ctx.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('uses the room time zone and hours as defaults for new agents', async () => {
    const w = await makeWorld();
    const room = createRoom(w.ctx, w.henry, { name: 'Tokyo', timezone: 'Asia/Tokyo', work_start: '09:00', work_end: '17:00' });
    const a = createAgent(w.ctx, w.henry, { name: 'Muse Tokyo', type: 'muse', room_ids: [room.id] });
    const s = scheduleFromRow(a.agent);
    expect(s.timezone).toBe('Asia/Tokyo');
    expect(s.workStart).toBe('09:00');
    expect(s.workEnd).toBe('17:00');
  });
});

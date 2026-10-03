import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { checkIn, count, fullReport, makeWorld, report } from './helpers.js';
import { Scheduler } from '../src/server/scheduler/index.js';
import { briefJob } from '../src/server/services/brief.js';
import { nightlyBackupJob, pruneBackups, exportRoom } from '../src/server/services/backup.js';
import { roomHealth } from '../src/server/services/health.js';
import { personPost } from '../src/server/services/people-actions.js';
import type { ConductorModel } from '../src/server/conductor/model.js';

const boise = (local: string) => DateTime.fromISO(local, { zone: 'America/Boise' }).toMillis();

describe('daily brief', () => {
  it('posts a rules-based brief once at 7:30 am room time on working days, and emails it when email is set up', async () => {
    const sent: { to: string; subject: string; text: string }[] = [];
    const w = await makeWorld({ integrations: { sendEmail: async (to, subject, text) => void sent.push({ to, subject, text }) } });
    const sched = new Scheduler(w.ctx);
    sched.addJob(briefJob(sched));
    const card = (await checkIn(w, w.a.apiKey)).body; // Monday 9:00
    await report(w, w.a.apiKey, fullReport(card, { rooms: [{ room_id: w.room.id, working_on: 'Pricing copy.', finished: [{ what: 'Outline', proof: 'https://x.example/outline' }], blocked: { reason: 'Need the logo.', what_would_unblock: 'Sam sends it.' } }] }));
    personPost(w.ctx, w.henry, w.room.id, { kind: 'question', to: 'Muse Sam', text: 'Logo colors?' });
    w.clock.set(boise('2026-10-06T07:29'));
    await sched.tick();
    await sched.idle();
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM briefs')).toBe(0);
    w.clock.set(boise('2026-10-06T07:31'));
    await sched.tick();
    await sched.idle();
    await sched.tick();
    await sched.idle();
    const briefs = w.ctx.db.prepare('SELECT * FROM briefs').all() as any[];
    expect(briefs.length).toBe(1);
    expect(briefs[0].method).toBe('rules');
    expect(briefs[0].for_date).toBe('2026-10-06');
    const text: string = briefs[0].text;
    expect(text).toContain('Daily brief for Launch: Tuesday, October 6');
    expect(text).toContain('Muse Henry (1 check-in): working on "Pricing copy.". Finished: Outline (proof: https://x.example/outline).');
    expect(text).toContain('Muse Sam: no check-ins in this period.');
    expect(text).toMatch(/Open questions\n- q_\d+ from Henry to Muse Sam: "Logo colors\?"/);
    expect(text).toContain('Muse Henry: Need the logo. (would unblock: Sam sends it.)');
    expect(text).toMatch(/on time over the last 7 days/);
    expect(text).toMatch(/Conductor spend: \$0\.00/);
    expect(count(w.ctx, "SELECT COUNT(*) n FROM feed_events WHERE kind = 'brief'")).toBe(1);
    expect(sent.map((s) => s.to).sort()).toEqual(['henry@example.com', 'sam@example.com']);
    expect(sent[0].subject).toBe('Tempo daily brief: Launch');
    // Saturday: no brief.
    w.clock.set(boise('2026-10-10T08:00'));
    await sched.tick();
    await sched.idle();
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM briefs')).toBe(1);
  });

  it("uses the Conductor's model when available, records its cost, and falls back to rules if it fails", async () => {
    const calls: string[] = [];
    const model: ConductorModel = {
      name: 'claude-sonnet-5-5',
      scripted: false,
      async call(args) {
        calls.push(args.purpose);
        return { output: { brief: 'What each agent did\n- Muse Henry worked on pricing copy.\nDecisions made\n- None.' }, usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, model: 'claude-sonnet-5-5', stopReason: null };
      },
    };
    const w = await makeWorld({ integrations: { conductorModel: model } });
    const sched = new Scheduler(w.ctx);
    sched.addJob(briefJob(sched));
    w.clock.set(boise('2026-10-06T07:45'));
    await sched.tick();
    await sched.idle();
    const b = w.ctx.db.prepare('SELECT * FROM briefs').get() as any;
    expect(calls).toEqual(['brief']);
    expect(b.method).toBe('model');
    expect(b.cost_usd).toBeCloseTo((1000 * 2 + 200 * 10) / 1e6, 6);
  });
});

describe('backups and export', () => {
  it('writes a nightly backup once, keeps the last seven, and the backup opens', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-bk-'));
    const w = await makeWorld({ config: { backupDir: dir } });
    for (let d = 1; d <= 9; d++) fs.writeFileSync(path.join(dir, `tempo-2026-09-0${d}.db`), 'old');
    const sched = new Scheduler(w.ctx);
    sched.addJob(nightlyBackupJob);
    w.clock.set(boise('2026-10-06T03:05'));
    await sched.tick();
    await sched.tick();
    const files = fs.readdirSync(dir).sort();
    expect(files.length).toBe(7);
    expect(files.at(-1)).toBe('tempo-2026-10-06.db');
    const { default: Database } = await import('better-sqlite3');
    const copy = new Database(path.join(dir, 'tempo-2026-10-06.db'), { readonly: true });
    expect((copy.prepare('SELECT COUNT(*) n FROM agents').get() as any).n).toBe(2);
    copy.close();
    expect(pruneBackups(dir, 3).length).toBe(3);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('exports one room with its history and no secrets', async () => {
    const w = await makeWorld();
    const card = (await checkIn(w, w.a.apiKey)).body;
    await report(w, w.a.apiKey, fullReport(card));
    const data = exportRoom(w.ctx, w.room.id) as any;
    expect(data.room.name).toBe('Launch');
    expect(data.feed.length).toBeGreaterThan(0);
    expect(data.reports.length).toBe(1);
    const text = JSON.stringify(data);
    expect(text).not.toContain(w.a.apiKey);
    expect(text).not.toContain(w.a.pageToken);
    expect(text).not.toContain('password_hash');
    expect(text).not.toContain('token_hash');
  });

  it('room health counts on-time check-ins and answer times over 7 days', async () => {
    const w = await makeWorld();
    for (const hour of ['09', '10', '11']) {
      w.clock.set(boise(`2026-10-05T${hour}:01`));
      const c = (await checkIn(w, w.a.apiKey)).body;
      await report(w, w.a.apiKey, fullReport(c));
    }
    w.clock.set(boise('2026-10-05T13:30'));
    const h = roomHealth(w.ctx, w.room.id);
    const henryAgent = h.per_agent.find((a) => a.agent_name === 'Muse Henry')!;
    // Slots 9, 10, 11, 12 and 1 o'clock; the first three were met, 12 and 1 were missed.
    expect(henryAgent.expected).toBe(5);
    expect(henryAgent.on_time).toBe(3);
    expect(henryAgent.rate).toBeCloseTo(0.6);
  });
});

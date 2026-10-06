import { describe, expect, it } from 'vitest';
import { makeWorld, type World } from './helpers.js';
import type { ConductorModel, ModelCallResult } from '../src/server/conductor/model.js';
import { alertBudgetWarning, spendOutlook } from '../src/server/conductor/budget.js';
import { conductorJob, sweepJob } from '../src/server/conductor/runner.js';
import { requestConductorRun } from '../src/server/conductor/queue.js';
import { Scheduler } from '../src/server/scheduler/index.js';
import { conductorSummary } from '../src/server/web/views.js';
import { createPersonRecord } from '../src/server/services/manage.js';

/**
 * Honest cost (outside review, fix 3). The Conductor panel shows the average cost per run this
 * month and a straight-line month-end projection next to the budget, and every admin is alerted
 * once a month when spending passes 80% of the budget.
 */

let n = 0;
function run(w: World, at: string, cost: number) {
  w.ctx.db
    .prepare(`INSERT INTO conductor_runs (id, room_id, mode, status, started_at, finished_at, cost_usd, attempts) VALUES (?, ?, 'autonomous', 'acted', ?, ?, ?, 1)`)
    .run(`run_t${++n}`, w.room.id, at, at, cost);
}

function brief(w: World, at: string, cost: number) {
  w.ctx.db
    .prepare(`INSERT INTO briefs (id, room_id, for_date, created_at, method, text, cost_usd) VALUES (?, ?, ?, ?, 'model', 'x', ?)`)
    .run(`brief_t${++n}`, w.room.id, at.slice(0, 10), at, cost);
}

const alerts = (w: World) => w.ctx.db.prepare(`SELECT * FROM alerts WHERE kind = 'budget_warning' ORDER BY rowid`).all() as any[];

describe('spend outlook', () => {
  it('has nothing to project before any spending', async () => {
    const w = await makeWorld();
    expect(spendOutlook(w.ctx)).toEqual({ spent: 0, paidRuns: 0, avgPerRun: null, projected: null, runsOutOn: null });
    run(w, '2026-10-02T10:00:00.000Z', 0); // a skipped or free run is not a paid run
    expect(spendOutlook(w.ctx).paidRuns).toBe(0);
  });

  it('averages the paid runs (not the briefs) and projects the month at its pace so far', async () => {
    const w = await makeWorld({ start: '2026-10-11T00:00:00.000Z', config: { conductorMonthlyBudgetUsd: 15 } });
    run(w, '2026-09-30T12:00:00.000Z', 5); // last month: not counted, but shows Tempo was already spending
    for (let d = 1; d <= 10; d++) run(w, `2026-10-${String(d).padStart(2, '0')}T12:00:00.000Z`, 0.25);
    brief(w, '2026-10-05T13:30:00.000Z', 0.5);
    const o = spendOutlook(w.ctx);
    expect(o.spent).toBeCloseTo(3, 9);
    expect(o.paidRuns).toBe(10);
    expect(o.avgPerRun).toBeCloseTo(0.25, 9);
    // $3 over 10 days is $0.30 a day; 21 days are left in October.
    expect(o.projected).toBeCloseTo(3 + 0.3 * 21, 6);
    expect(o.runsOutOn).toBeNull();
  });

  it('says when the budget runs out if the pace would pass it', async () => {
    const w = await makeWorld({ start: '2026-10-11T00:00:00.000Z', config: { conductorMonthlyBudgetUsd: 15 } });
    run(w, '2026-09-30T12:00:00.000Z', 1);
    run(w, '2026-10-01T00:00:00.000Z', 6);
    const o = spendOutlook(w.ctx);
    // $6 in 10 days is $0.60 a day: the other $9 lasts 15 days.
    expect(o.projected).toBeCloseTo(6 + 0.6 * 21, 6);
    expect(o.runsOutOn).toBe('2026-10-26');
  });

  it('measures the pace from the first paid call when Tempo started mid-month, and over at least a day', async () => {
    const w = await makeWorld({ start: '2026-10-21T00:00:00.000Z', config: { conductorMonthlyBudgetUsd: 15 } });
    run(w, '2026-10-20T00:00:00.000Z', 1);
    // $1 in its first day is $1 a day (not $1 over 20 days); 11 days are left.
    expect(spendOutlook(w.ctx).projected).toBeCloseTo(12, 6);

    const w2 = await makeWorld({ start: '2026-10-21T00:00:00.000Z', config: { conductorMonthlyBudgetUsd: 15 } });
    run(w2, '2026-10-20T23:00:00.000Z', 0.5);
    // One hour of spending is spread over a whole day, so a busy first hour does not project wildly.
    expect(spendOutlook(w2.ctx).projected).toBeCloseTo(0.5 + 0.5 * 11, 6);
  });

  it('reaches the Conductor panel', async () => {
    const w = await makeWorld({ start: '2026-10-11T00:00:00.000Z', config: { conductorMonthlyBudgetUsd: 15 } });
    run(w, '2026-10-01T00:00:00.000Z', 6);
    const s = conductorSummary(w.ctx, w.room as any);
    expect(s).toMatchObject({ month_spent_usd: 6, month_budget_usd: 15, month_paid_runs: 1, month_avg_run_usd: 6, month_projected_usd: 18.6, budget_runs_out_on: '2026-10-26' });
  });
});

describe('the 80% budget alert', () => {
  it('tells every admin once a month, in the app and by email and phone, when spending passes 80%', async () => {
    const sent: { to: string; subject: string; text: string }[] = [];
    const pushed: { topic: string; title: string }[] = [];
    const w = await makeWorld({
      start: '2026-10-11T00:00:00.000Z',
      config: { conductorMonthlyBudgetUsd: 15 },
      integrations: { sendEmail: async (to, subject, text) => void sent.push({ to, subject, text }), sendPush: async (topic, title) => void pushed.push({ topic, title }) },
    });
    w.ctx.db.prepare('UPDATE people SET ntfy_topic = ? WHERE id = ?').run('tempo-henry-test', w.henry.id);
    const ada = createPersonRecord(w.ctx, { name: 'Ada', email: 'ada@example.com', passwordHash: 'x', role: 'admin' });
    const old = createPersonRecord(w.ctx, { name: 'Old', email: 'old@example.com', passwordHash: 'x', role: 'admin' });
    w.ctx.db.prepare('UPDATE people SET disabled_at = ? WHERE id = ?').run('2026-10-01T00:00:00.000Z', old.id);
    const sched = new Scheduler(w.ctx);

    run(w, '2026-10-01T00:00:00.000Z', 11.9); // 79%: nothing yet
    await sched.tick();
    await sched.idle();
    expect(alerts(w)).toHaveLength(0);

    run(w, '2026-10-10T00:00:00.000Z', 0.3); // $12.20: 81%
    await sched.tick();
    await sched.idle();
    const first = alerts(w);
    // Henry and Ada are admins; Sam is not, and Old's account is turned off.
    expect(first.map((a) => a.person_id).sort()).toEqual([ada.id, w.henry.id].sort());
    expect(first[0].title).toBe("Tempo: 81% of this month's Conductor budget is used");
    expect(first[0].body).toBe(
      "The Conductor has used $12.20 of this month's $15.00 budget (81%). At this pace it runs out around October 13. " +
        'When the budget is used up, every room acts as relay (only people give instructions) until next month. ' +
        "To allow more, raise CONDUCTOR_MONTHLY_BUDGET_USD and restart Tempo. These amounts are Tempo's estimate; your Anthropic bill is the final word.",
    );
    // Alerts never carry project content: no room name, goal or agent words.
    expect(first[0].body).not.toContain(w.room.name);
    expect(first[0].room_id).toBeNull();
    expect(sent.map((s) => s.to).sort()).toEqual(['ada@example.com', 'henry@example.com']);
    expect(pushed).toEqual([{ topic: 'tempo-henry-test', title: "Tempo: 81% of this month's Conductor budget is used" }]);
    expect(JSON.parse(first.find((a) => a.person_id === w.henry.id).deliveries)).toMatchObject({ app: 'shown', email: 'sent', push: 'sent' });

    // Once a month: more spending, even past the budget, does not alert again.
    run(w, '2026-10-10T12:00:00.000Z', 5);
    for (let i = 0; i < 3; i++) {
      w.clock.advance(30_000);
      await sched.tick();
      await sched.idle();
    }
    expect(alerts(w)).toHaveLength(2);
    expect(sent).toHaveLength(2);

    // A new month starts from zero; crossing 80% again alerts again.
    w.clock.set(Date.parse('2026-11-20T00:00:00.000Z'));
    await sched.tick();
    expect(alerts(w)).toHaveLength(2);
    run(w, '2026-11-19T00:00:00.000Z', 15);
    await sched.tick();
    await sched.idle();
    const nov = alerts(w).slice(2);
    expect(nov).toHaveLength(2);
    expect(nov[0].title).toBe("Tempo: this month's Conductor budget is used up");
    expect(nov[0].body).toMatch(/^The Conductor has used \$15\.00 of this month's \$15\.00 budget \(100%\)\. When the budget/);
  });

  it('fires from a real Conductor run that pushes spending past 80%', async () => {
    const model: ConductorModel = {
      name: 'claude-sonnet-5-5',
      scripted: false,
      async call(): Promise<ModelCallResult> {
        return {
          output: { summary: 'Nothing to change.', nothing_to_do: true, instructions: [], questions: [], instruction_changes: [], decisions: [], answers: [], room_note: null, playbook_suggestions: [] },
          // 5,000 in and 800 out at $2 / $10 per million: $0.018.
          usage: { input_tokens: 5000, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          model: 'claude-sonnet-5-5',
          stopReason: null,
        };
      },
    };
    const w = await makeWorld({ config: { conductorMonthlyBudgetUsd: 0.02 }, integrations: { conductorModel: model } });
    const sched = new Scheduler(w.ctx);
    sched.addJob(conductorJob(sched));
    sched.addJob(sweepJob);
    requestConductorRun(w.ctx.db, w.room.id, { kind: 'manual', detail: 'test' }, w.clock.now(), 0);
    w.clock.advance(1000);
    await sched.tick();
    await sched.idle();
    await sched.tick();
    await sched.idle();
    expect(alerts(w).map((a) => a.person_id)).toEqual([w.henry.id]);
    expect(alerts(w)[0].title).toBe("Tempo: 90% of this month's Conductor budget is used");
  });

  it('stays quiet when there is no budget to warn about', async () => {
    const w = await makeWorld({ config: { conductorMonthlyBudgetUsd: 0 } });
    run(w, '2026-10-05T10:00:00.000Z', 1);
    alertBudgetWarning(w.ctx);
    expect(alerts(w)).toHaveLength(0);
  });
});

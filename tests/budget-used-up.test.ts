import { describe, expect, it } from 'vitest';
import { makeWorld, type World } from './helpers.js';
import type { ConductorModel } from '../src/server/conductor/model.js';
import { runConductor } from '../src/server/conductor/runner.js';
import { writeBrief } from '../src/server/services/brief.js';
import { getRoom } from '../src/server/services/repo.js';
import { conductorSummary } from '../src/server/web/views.js';
import { monthEndText, outlookLine } from '../src/web/screens/room/spend-words.js';

/**
 * Review round 2: the cost box said "About $96 at this pace, against a budget of $15" with $16.52
 * spent, as if spending would go on. These tests pin down what really happens once the budget is
 * used up (the words on screen rely on it) and that the server tells the screen so.
 */

function paidModel(calls: string[]): ConductorModel {
  return {
    name: 'test-model',
    scripted: false,
    async call(args) {
      calls.push(args.purpose ?? 'conductor');
      return {
        output: { brief: 'What each agent did\n- Muse Henry worked on pricing copy.\nDecisions made\n- None.' },
        usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        model: 'test-model',
        stopReason: null,
      };
    },
  };
}

function spend(w: World, at: string, cost: number) {
  w.ctx.db
    .prepare(`INSERT INTO conductor_runs (id, room_id, triggers, mode, status, started_at, finished_at, cost_usd, attempts) VALUES (?, ?, '[]', 'autonomous', 'acted', ?, ?, ?, 1)`)
    .run(`run_spent_${at}`, w.room.id, at, at, cost);
}

/**
 * The review's month: $16.52 spent between October 1 and October 6, about $3.30 a day. Runs on
 * October 1 to 5 ($2.80 each), then a model-written daily brief on October 6 ($2.52) uses the budget
 * up. After that nothing more is spent until next month.
 */
function spendFiveDays(w: World) {
  for (let d = 1; d <= 5; d++) spend(w, `2026-10-0${d}T00:00:00.000Z`, 2.8);
  w.ctx.db
    .prepare(`INSERT INTO briefs (id, room_id, for_date, created_at, method, text, cost_usd) VALUES ('brief_spent', ?, '2026-10-05', '2026-10-06T00:00:00.000Z', 'model', 'x', 2.52)`)
    .run(w.room.id);
}

describe('when the monthly budget is used up', () => {
  // October 6, 2026: $16.52 spent of $15 in five days is about $3.30 a day, about $102 for the month.
  const start = '2026-10-06T00:00:00.000Z';

  it('the server tells the screen the budget is used up, and still gives the pace', async () => {
    const w = await makeWorld({ start, config: { conductorMonthlyBudgetUsd: 15 }, integrations: { conductorModel: paidModel([]) } });
    spendFiveDays(w);
    const s = conductorSummary(w.ctx, getRoom(w.ctx.db, w.room.id)!);
    expect(s).toMatchObject({ effective_mode: 'relay', budget_used_up: true, month_spent_usd: 16.52, month_budget_usd: 15, budget_runs_out_on: null });
    expect(s.month_projected_usd).toBeCloseTo(16.52 + (16.52 / 5) * 26, 2);
    expect(Math.round(s.month_projected_usd!)).toBe(102);
  });

  it('gives the pace before spending stopped, which does not shrink in the days after', async () => {
    // Review round 3: the pace was spend / days so far, so every day after the stop pulled it down
    // ($102 on October 6, $37 on the 15th, $21 on the 25th, $18 on the 31st), and an owner reading
    // it to decide how much to raise the budget would raise it too little.
    const w = await makeWorld({ start, config: { conductorMonthlyBudgetUsd: 15 }, integrations: { conductorModel: paidModel([]) } });
    spendFiveDays(w);
    const atStop = conductorSummary(w.ctx, getRoom(w.ctx.db, w.room.id)!).month_projected_usd!;
    expect(atStop).toBeCloseTo(16.52 + (16.52 / 5) * 26, 2);
    for (const day of ['2026-10-15', '2026-10-25', '2026-10-31']) {
      w.clock.set(`${day}T23:00:00.000Z`);
      const s = conductorSummary(w.ctx, getRoom(w.ctx.db, w.room.id)!);
      expect(s).toMatchObject({ effective_mode: 'relay', budget_used_up: true, month_spent_usd: 16.52 });
      expect(s.month_projected_usd, `on ${day}`).toBeCloseTo(atStop, 2);
      expect(monthEndText(s), `on ${day}`).toBe('Spending has stopped until next month, because the budget is used up. At this pace the month would have cost about $102.');
      expect(outlookLine(s), `on ${day}`).toContain('At this pace the month would have cost about $102');
    }
  });

  it('is not used up a cent before the budget', async () => {
    const w = await makeWorld({ start, config: { conductorMonthlyBudgetUsd: 15 }, integrations: { conductorModel: paidModel([]) } });
    spend(w, '2026-10-01T00:00:00.000Z', 14.99);
    expect(conductorSummary(w.ctx, getRoom(w.ctx.db, w.room.id)!)).toMatchObject({ effective_mode: 'autonomous', budget_used_up: false });
    spend(w, '2026-10-02T00:00:00.000Z', 0.01);
    expect(conductorSummary(w.ctx, getRoom(w.ctx.db, w.room.id)!)).toMatchObject({ effective_mode: 'relay', budget_used_up: true });
  });

  it('spending really stops: the Conductor makes no model call, and the daily brief is written by rules at no cost', async () => {
    const calls: string[] = [];
    const w = await makeWorld({ start, config: { conductorMonthlyBudgetUsd: 15 }, integrations: { conductorModel: paidModel(calls) } });
    spend(w, '2026-10-01T00:00:00.000Z', 16.52);
    await runConductor(w.ctx, w.room.id);
    const run = w.ctx.db.prepare('SELECT status, skip_reason, cost_usd FROM conductor_runs ORDER BY rowid DESC LIMIT 1').get() as any;
    expect(run).toMatchObject({ status: 'skipped', skip_reason: 'monthly budget used up: relay mode', cost_usd: 0 });
    await writeBrief(w.ctx, getRoom(w.ctx.db, w.room.id)!, '2026-10-06');
    const brief = w.ctx.db.prepare('SELECT method, cost_usd FROM briefs').get() as any;
    expect(brief).toEqual({ method: 'rules', cost_usd: 0 });
    expect(calls).toEqual([]);
  });
});

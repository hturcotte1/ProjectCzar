import { describe, expect, it } from 'vitest';
import type { ConductorSummary } from '../src/shared/app-types.js';
import { budgetLeftText, monthEndText, outlookLine } from '../src/web/screens/room/spend-words.js';

/**
 * The Conductor's cost in words (the Cost and activity box and the side panel's small print).
 * Review round 2: with $16.52 spent of a $15 budget the box read "About $96 at this pace, against a
 * budget of $15", as if spending would go on; it stops when the budget is used up (no model calls,
 * rooms act as relay, briefs are written by rules) until next month.
 */

function summary(over: Partial<ConductorSummary>): ConductorSummary {
  return {
    mode: 'autonomous',
    effective_mode: 'autonomous',
    banner: null,
    model: 'test-model',
    scripted: false,
    has_key: true,
    month_spent_usd: 0,
    month_budget_usd: 15,
    month_paid_runs: 0,
    month_avg_run_usd: null,
    month_projected_usd: null,
    budget_runs_out_on: null,
    budget_used_up: false,
    runs_last_hour: 0,
    max_runs_per_hour: 12,
    pending_run_at: null,
    last_run: null,
    ...over,
  };
}

/** The review's numbers: $16.52 spent of $15 by October 6, a pace of about $96 for the month. */
const usedUp = summary({
  effective_mode: 'relay',
  banner: "Relay mode: this month's Conductor budget ($15.00) is used up, so only people give instructions until next month. Raise CONDUCTOR_MONTHLY_BUDGET_USD to continue.",
  month_spent_usd: 16.52,
  month_paid_runs: 40,
  month_avg_run_usd: 0.413,
  month_projected_usd: 96.13,
  budget_used_up: true,
});

describe('the cost box when the budget is used up', () => {
  it('says spending has stopped, and gives the pace only as what the month would have cost', () => {
    expect(monthEndText(usedUp)).toBe('Spending has stopped until next month, because the budget is used up. At this pace the month would have cost about $96.');
    expect(monthEndText(usedUp)).not.toContain('against a budget');
  });

  it('says what happens until next month', () => {
    expect(budgetLeftText(usedUp)).toBe(
      'The budget is used up, so spending has stopped until next month. Until then the Conductor is off and rooms act as relay: people give the instructions, and questions, answers and decisions still flow. Daily briefs still arrive, written without the Conductor, at no cost.',
    );
  });

  it('says the same in the side panel', () => {
    expect(outlookLine(usedUp)).toBe('Spending has stopped until next month · At this pace the month would have cost about $96 · $0.41 a run on average (40 runs)');
    expect(outlookLine(usedUp)).not.toContain('by month end');
  });

  it('follows the server on whether the budget is used up, not rounded figures', () => {
    // $14.99996 shows as $15.00 of $15, but the budget is not used up until the server says so.
    const almost = summary({ month_spent_usd: 15, month_projected_usd: 15.2, month_avg_run_usd: 0.5, month_paid_runs: 30, budget_used_up: false });
    expect(monthEndText(almost)).toBe('About $15 at this pace, against a budget of $15');
    expect(budgetLeftText(almost)).toBe('$0.00 left.');
    // A budget of $0 is used up from the start: nothing to project.
    const zero = summary({ month_budget_usd: 0, effective_mode: 'relay', budget_used_up: true });
    expect(monthEndText(zero)).toBe('Spending has stopped until next month, because the budget is used up.');
    expect(outlookLine(zero)).toBe('Spending has stopped until next month');
  });
});

describe('the cost box before the budget is used up', () => {
  it('keeps the plain projection when the month stays inside the budget', () => {
    const c = summary({ month_spent_usd: 3, month_projected_usd: 9.3, month_avg_run_usd: 0.25, month_paid_runs: 10 });
    expect(monthEndText(c)).toBe('About $9.30 at this pace, against a budget of $15');
    expect(budgetLeftText(c)).toBe('$12 left.');
    expect(outlookLine(c)).toBe('About $9.30 by month end at this pace · $0.25 a run on average (10 runs)');
  });

  it('says spending stops when the budget will run out, instead of a month total that will not happen', () => {
    const c = summary({ month_spent_usd: 6, month_projected_usd: 18.6, month_avg_run_usd: 6, month_paid_runs: 1, budget_runs_out_on: '2026-10-26' });
    expect(monthEndText(c)).toBe('At this pace the budget runs out around October 26, and spending stops until next month. Without that stop, the month would come to about $19.');
    expect(outlookLine(c)).toBe('At this pace the budget runs out around October 26 · $6.00 a run on average (1 run)');
  });

  it('has nothing to project before any spending', () => {
    const c = summary({});
    expect(monthEndText(c)).toBe('Nothing spent yet this month');
    expect(budgetLeftText(c)).toBe('$15 left.');
    expect(outlookLine(c)).toBeNull();
  });
});

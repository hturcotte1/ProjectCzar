import type { ConductorSummary } from '../../../shared/app-types';
import { money } from '../../lib/format';

/**
 * The Conductor's cost in words, for the Cost and activity box and the side panel. Plain functions
 * with no screen parts, so the automatic tests can check every sentence.
 */

/** "under $0.01", "$0.02", "$12" */
export function cost(usd: number): string {
  if (!usd) return 'no cost';
  if (usd < 0.005) return 'under $0.01';
  return money(usd);
}

/** Month-to-date spend: "$0.00", "under $0.01", "$0.42", "$12". */
export function spentText(usd: number): string {
  return usd > 0 && usd < 0.005 ? cost(usd) : money(usd);
}

/** "October 24" from "2026-10-24". */
export function dayWords(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Once the budget is used up, spending stops until next month: the Conductor makes no more calls
 * (rooms act as relay) and daily briefs are written by rules, at no cost. The pace then only says
 * what the month would have cost; it is not where the month is heading. The server measures that
 * pace up to the last spending, so the figure stays put after the stop. The server decides "used
 * up" with the same test that stops the spending (`budget_used_up`), never from rounded figures.
 */
const STOPPED = 'Spending has stopped until next month';

/** "At this pace the month would have cost about $96", or null with nothing to project. */
function wouldHaveCost(c: ConductorSummary): string | null {
  return c.month_projected_usd === null ? null : `At this pace the month would have cost about ${spentText(c.month_projected_usd)}`;
}

/** Where the month is heading, in the side panel's small print. */
export function projectionText(c: ConductorSummary): string | null {
  if (c.budget_used_up) return [STOPPED, wouldHaveCost(c)].filter(Boolean).join(' · ');
  if (c.budget_runs_out_on) return `At this pace the budget runs out around ${dayWords(c.budget_runs_out_on)}`;
  if (c.month_projected_usd === null) return null;
  return `About ${spentText(c.month_projected_usd)} by month end at this pace`;
}

/** "$0.04 a run on average (23 runs)". */
export function averageText(c: ConductorSummary): string | null {
  if (c.month_avg_run_usd === null) return null;
  return `${spentText(c.month_avg_run_usd)} a run on average (${c.month_paid_runs} ${c.month_paid_runs === 1 ? 'run' : 'runs'})`;
}

/** The side panel's small print under the spend bar: the projection and the average. */
export function outlookLine(c: ConductorSummary): string | null {
  const parts = [projectionText(c), averageText(c)].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** The first sentences under the big spend figure: what is left, or that spending has stopped and what happens meanwhile. */
export function budgetLeftText(c: ConductorSummary): string {
  if (c.budget_used_up) {
    return (
      'The budget is used up, so spending has stopped until next month. Until then the Conductor is off and rooms act as relay: ' +
      'people give the instructions, and questions, answers and decisions still flow. Daily briefs still arrive, written without the Conductor, at no cost.'
    );
  }
  return `${money(Math.max(0, c.month_budget_usd - c.month_spent_usd))} left.`;
}

/** The Cost and activity box's "By month end" line. */
export function monthEndText(c: ConductorSummary): string {
  if (c.budget_used_up) {
    const would = wouldHaveCost(c);
    return `${STOPPED}, because the budget is used up.${would ? ` ${would}.` : ''}`;
  }
  if (c.month_projected_usd === null) return 'Nothing spent yet this month';
  if (c.budget_runs_out_on) {
    return `At this pace the budget runs out around ${dayWords(c.budget_runs_out_on)}, and spending stops until next month. Without that stop, the month would come to about ${spentText(c.month_projected_usd)}.`;
  }
  return `About ${spentText(c.month_projected_usd)} at this pace, against a budget of ${money(c.month_budget_usd)}`;
}

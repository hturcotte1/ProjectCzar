import type { ConductorSummary } from '../../../shared/app-types';
import { money } from '../../lib/format';
import { NextRun, SpendBar, dayWords, spentText } from './conductor-common';
import './room-c.css';

/** Month-to-date spend against the budget, the model in use and how busy the Conductor has been. */
export function UsageCard({ summary }: { summary: ConductorSummary }) {
  const c = summary;
  const left = Math.max(0, c.month_budget_usd - c.month_spent_usd);
  return (
    <div className="stack">
      <div>
        <div className="c-usage-big">
          {spentText(c.month_spent_usd)} <span className="muted" style={{ fontSize: '1rem', fontWeight: 500 }}>of {money(c.month_budget_usd)} this month</span>
        </div>
        <div style={{ margin: '8px 0 6px' }}>
          <SpendBar spent={c.month_spent_usd} budget={c.month_budget_usd} large />
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {left > 0 ? `${money(left)} left.` : 'The budget is used up, so rooms act as relay until next month.'} This one budget is shared by every room, and covers the Conductor's runs and the daily briefs it writes.
        </p>
      </div>

      <dl className="kv" data-testid="spend-outlook-detail">
        <dt>Average per run</dt>
        <dd>{c.month_avg_run_usd === null ? 'No paid runs yet this month' : `${spentText(c.month_avg_run_usd)} (${c.month_paid_runs} paid ${c.month_paid_runs === 1 ? 'run' : 'runs'} this month, all rooms)`}</dd>
        <dt>By month end</dt>
        <dd>
          {c.month_projected_usd === null
            ? 'Nothing spent yet this month'
            : c.budget_runs_out_on
              ? `At this pace the budget runs out around ${dayWords(c.budget_runs_out_on)} (the whole month would come to about ${spentText(c.month_projected_usd)})`
              : `About ${spentText(c.month_projected_usd)} at this pace, against a budget of ${money(c.month_budget_usd)}`}
        </dd>
        <dt>Model</dt>
        <dd>{c.scripted ? 'A built-in stand-in for practice (free)' : c.has_key ? c.model : `${c.model} (no API key is set)`}</dd>
        <dt>Runs in the last hour</dt>
        <dd>
          {c.runs_last_hour} of {c.max_runs_per_hour} allowed
        </dd>
        {c.pending_run_at && (
          <>
            <dt>Next run</dt>
            <dd>
              <NextRun iso={c.pending_run_at} />
            </dd>
          </>
        )}
      </dl>
      <p className="tiny muted" style={{ margin: 0 }}>
        These amounts are Tempo's estimates, worked out from the tokens each run used and Anthropic's list prices. Your Anthropic bill is the final word. The month-end figure assumes the rest of the month goes like it has so far.
      </p>
    </div>
  );
}

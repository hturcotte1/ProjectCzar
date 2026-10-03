import type { ReactNode } from 'react';
import type { ConductorRunView } from '../../../shared/app-types';
import { Empty, Pill, Time } from '../../components/ui';
import { SafeText } from '../../components/SafeText';
import { ACTION_WORDS, MODE_WORDS, STATUS_WORDS, TRIGGER_WORDS, cost, plainIds, sentence } from './conductor-common';
import './room-c.css';

/** Several triggers of one kind (ten check-ins in a row) read better as one line with a count. */
function groupTriggers(triggers: ConductorRunView['triggers']) {
  const groups = new Map<string, { kind: string; count: number; details: string[] }>();
  for (const t of triggers) {
    const g = groups.get(t.kind) ?? { kind: t.kind, count: 0, details: [] };
    g.count++;
    if (t.detail) g.details.push(plainIds(t.detail));
    groups.set(t.kind, g);
  }
  return [...groups.values()];
}

/** One line that says what this run came to, for the closed state. */
function gist(run: ConductorRunView): string {
  if (run.status === 'failed') return run.error ? `It could not finish: ${run.error}` : 'It could not finish.';
  if (run.status === 'running') return run.saw_summary ? `Looking at: ${run.saw_summary}` : 'Looking at the room now.';
  if (run.status === 'skipped') return sentence(run.skip_reason ?? run.summary ?? 'It did not run.');
  return sentence(run.summary ?? (run.status === 'nothing_to_do' ? 'Nothing needed doing.' : 'No summary was written.'));
}

/** "An agent checked in: Muse Sam, Instinct Henry" or "A person gave an instruction (Henry gave an instruction)". */
function TriggerLine({ group: g }: { group: ReturnType<typeof groupTriggers>[number] }) {
  const words = TRIGGER_WORDS[g.kind] ?? sentence(g.kind.replace(/_/g, ' '));
  if (g.kind === 'checkin') {
    const names = [...new Set(g.details.map((d) => d.replace(/\s+checked in.*$/i, '').trim()).filter(Boolean))];
    if (names.length > 0) {
      return (
        <>
          {names.length === 1 ? 'An agent checked in' : 'Agents checked in'}: <SafeText text={names.slice(0, 6).join(', ')} />
          {names.length > 6 && <span className="muted"> and {names.length - 6} more</span>}
        </>
      );
    }
  }
  return (
    <>
      {words}
      {g.count > 1 && <span className="muted"> ({g.count} times)</span>}
      {g.details.length > 0 && (
        <span className="small muted">
          {' '}
          <SafeText text={`(${g.details.slice(-3).join('; ')})`} />
        </span>
      )}
    </>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <span className="c-label">{title}</span>
      {children}
    </div>
  );
}

function RunItem({ run }: { run: ConductorRunView }) {
  const status = STATUS_WORDS[run.status];
  const triggers = groupTriggers(run.triggers);
  const mode = run.mode in MODE_WORDS ? MODE_WORDS[run.mode as keyof typeof MODE_WORDS].name : run.mode;
  const tokens = run.input_tokens + run.output_tokens;
  return (
    <li className="c-run">
      <details>
        <summary>
          <span className="c-run-top">
            <Pill tone={status.tone}>{status.label}</Pill>
            <Time iso={run.started_at} className="small muted" />
            <span className="small faint c-run-cost">{cost(run.cost_usd)}</span>
          </span>
          <span className="c-run-gist c-clamp c-clamp-2">
            <SafeText text={gist(run)} />
          </span>
          <span className="c-run-more">
            <span className="c-run-more-closed">Show details</span>
            <span className="c-run-more-open">Hide details</span>
          </span>
        </summary>

        <div className="c-run-body">
          {run.status === 'failed' && (
            <div className="c-run-error" role="alert">
              <strong>Something went wrong.</strong> <SafeText text={run.error ?? 'No reason was recorded.'} />
            </div>
          )}
          {run.status === 'skipped' && run.skip_reason && (
            <Part title="Why it was skipped">
              <p>
                <SafeText text={sentence(run.skip_reason)} />
              </p>
            </Part>
          )}

          <Part title="What woke it up">
            {triggers.length === 0 ? (
              <p className="muted">Nothing was recorded.</p>
            ) : (
              <ul className="c-triggers">
                {triggers.map((g) => (
                  <li key={g.kind}>
                    <TriggerLine group={g} />
                  </li>
                ))}
              </ul>
            )}
          </Part>

          {run.saw_summary && (
            <Part title="What it saw">
              <p>
                <SafeText text={run.saw_summary} />
              </p>
            </Part>
          )}

          {run.summary && run.status !== 'skipped' && (
            <Part title="What it decided and why">
              <p>
                <SafeText text={run.summary} />
              </p>
            </Part>
          )}

          {run.actions.length > 0 && (
            <Part title="What it did">
              <ul className="c-actions">
                {run.actions.map((a, i) => (
                  <li key={i}>
                    <Pill>{ACTION_WORDS[a.kind] ?? sentence(a.kind)}</Pill>
                    <span>
                      <SafeText text={plainIds(a.text)} />
                    </span>
                  </li>
                ))}
              </ul>
            </Part>
          )}

          <Part title="Cost">
            <p className="small muted">
              {run.status === 'running'
                ? 'Still running; the cost is added when it finishes.'
                : run.status === 'skipped'
                  ? 'No model was used, so this cost nothing.'
                  : run.cost_usd > 0 && tokens > 0
                    ? `${sentence(cost(run.cost_usd))}. Read ${run.input_tokens.toLocaleString()} and wrote ${run.output_tokens.toLocaleString()} tokens (${tokens.toLocaleString()} in all).`
                    : 'No cost.'}
              {run.model ? ` Model: ${run.model}.` : ''} Mode when it ran: {mode}.
            </p>
          </Part>
        </div>
      </details>
    </li>
  );
}

/** Every Conductor run, newest first: what triggered it, what it saw, what it decided and what it cost. */
export function RunLog({ runs }: { runs: ConductorRunView[] | null }) {
  if (runs === null) return <p className="muted">Loading the log…</p>;
  if (runs.length === 0) {
    return <Empty>The Conductor has not run in this room yet. It runs when agents check in, when someone gives an instruction or changes the goal, and when you press Run now.</Empty>;
  }
  return (
    <>
      <ul className="c-runs" aria-label="Conductor runs, newest first">
        {runs.map((r) => (
          <RunItem key={r.id} run={r} />
        ))}
      </ul>
      {runs.length >= 50 && <p className="small faint">Showing the 50 most recent runs.</p>}
    </>
  );
}

import type { HealthView } from '../../../shared/app-types';
import { linkProps } from '../../lib/router';
import { percent } from '../../lib/format';
import { Empty, ErrorBanner, Time } from '../../components/ui';
import { SafeText } from '../../components/SafeText';
import { plainIds } from './conductor-common';
import { useRoomData } from './conductor-load';
import './room-c.css';

type Tone = 'green' | 'amber' | 'red' | 'none';

/** 90% and up is healthy, 70% and up is slipping, below that needs attention. */
function rateTone(rate: number | null): Tone {
  if (rate === null) return 'none';
  return rate >= 0.9 ? 'green' : rate >= 0.7 ? 'amber' : 'red';
}

/** "under a minute", "about 25 min", "about 2 h", "about 3 days" */
function durationText(minutes: number): string {
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `about ${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `about ${Math.round(hours * 2) / 2} h`;
  return `about ${Math.round(hours / 24)} days`;
}

/** Room health over the last 7 days, in plain numbers. */
export function HealthTab({ roomId }: { roomId: string }) {
  const { data, error } = useRoomData<HealthView>(
    `/rooms/${roomId}/health`,
    (e) =>
      (e.type === 'agent' && e.room_ids.includes(roomId)) ||
      (e.type === 'room' && e.room_id === roomId) ||
      (e.type === 'feed' && e.room_id === roomId && ['report', 'question', 'answer'].includes(e.event.kind)),
  );

  return (
    <div className="c-page stack" style={{ gap: 18 }}>
      <header className="c-head">
        <h2>Room health</h2>
        <p className="c-intro">How the last {data?.window_days ?? 7} days have gone: are agents checking in on time, how fast questions get answered, and what is stuck.</p>
      </header>

      <ErrorBanner error={error} />
      {data === null && !error && <p className="muted">Working out the numbers…</p>}
      {data && <HealthBody health={data} roomId={roomId} />}
    </div>
  );
}

function HealthBody({ health: h, roomId }: { health: HealthView; roomId: string }) {
  const tone = rateTone(h.on_time_rate);
  const blockers = h.open_blockers;
  return (
    <>
      <div className="c-stats" aria-live="polite">
        <section className="card c-stat" aria-labelledby="c-h-ontime">
          <h3 id="c-h-ontime">Check-ins on time</h3>
          <div className="c-stat-number" data-tone={tone}>
            {percent(h.on_time_rate)}
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            {h.checkins_expected > 0 ? `${h.checkins_on_time} of ${h.checkins_expected} scheduled check-ins arrived on time.` : 'No check-ins have been due yet, so there is nothing to measure.'}
          </p>
        </section>

        <section className="card c-stat" aria-labelledby="c-h-answer">
          <h3 id="c-h-answer">Time to get an answer</h3>
          <div className={`c-stat-number${h.median_answer_minutes === null ? '' : ' c-stat-text'}`} data-tone={h.median_answer_minutes === null ? 'none' : undefined}>
            {h.median_answer_minutes === null ? '—' : durationText(h.median_answer_minutes)}
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            {h.answered_questions > 0
              ? `A typical question was answered in this time. Based on ${h.answered_questions} answered ${h.answered_questions === 1 ? 'question' : 'questions'}.`
              : 'No questions have been answered yet.'}
          </p>
        </section>

        <section className="card c-stat" aria-labelledby="c-h-blockers">
          <h3 id="c-h-blockers">Open blockers</h3>
          <div className="c-stat-number" data-tone={blockers.length ? 'red' : 'green'}>
            {blockers.length}
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            {blockers.length === 0 ? 'Nothing is blocking anyone right now.' : `${blockers.length === 1 ? 'Something is' : 'Things are'} stopping an agent from moving on. Details are below.`}
          </p>
        </section>
      </div>

      <section aria-labelledby="c-h-agents" className="stack-sm">
        <h3 id="c-h-agents">Each agent</h3>
        {h.per_agent.length === 0 ? (
          <Empty>No agents are in this room yet. Add one in Settings.</Empty>
        ) : (
          <div className="card-flat table-wrap c-agent-wrap">
            <table className="table c-agent-table">
              <caption className="sr-only">Check-ins for each agent over the last {h.window_days} days</caption>
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col" className="c-num">
                    Expected
                  </th>
                  <th scope="col" className="c-num">
                    On time
                  </th>
                  <th scope="col" className="c-num">
                    Rate
                  </th>
                  <th scope="col" className="c-num">
                    Incomplete
                  </th>
                </tr>
              </thead>
              <tbody>
                {h.per_agent.map((a) => (
                  <tr key={a.agent_id}>
                    <th scope="row" className="c-rowhead">
                      <a {...linkProps(`/agents/${a.agent_id}`)}>{a.agent_name}</a>
                    </th>
                    <td className="c-num">{a.expected}</td>
                    <td className="c-num">{a.on_time}</td>
                    <td className="c-num">
                      {a.rate !== null && (
                        <span className="c-rate-bar" data-tone={rateTone(a.rate)} aria-hidden="true">
                          <span style={{ width: `${Math.round(a.rate * 100)}%` }} />
                        </span>
                      )}
                      {percent(a.rate)}
                    </td>
                    <td className="c-num">{a.incomplete_cards}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {h.per_agent.length > 0 && (
          <p className="tiny faint" style={{ margin: 0 }}>
            Expected is how many check-ins were due. Incomplete means the agent was given a check-in but never finished it.
          </p>
        )}
      </section>

      {blockers.length > 0 && (
        <section aria-labelledby="c-h-blocked" className="stack-sm">
          <h3 id="c-h-blocked">What is blocked</h3>
          <ul className="c-blockers">
            {blockers.map((b, i) => (
              <li key={`${b.agent_id}-${i}`} className="c-blocker">
                <div className="row" style={{ gap: 8 }}>
                  <strong>
                    <SafeText text={b.agent_name} />
                  </strong>
                  <span className="small muted">
                    since <Time iso={b.since} />
                  </span>
                </div>
                <div>
                  <SafeText text={plainIds(b.reason)} />
                </div>
                {b.what_would_unblock && (
                  <div className="small">
                    <span className="muted">What would help: </span>
                    <SafeText text={b.what_would_unblock} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="small muted" style={{ margin: 0 }}>
            Anything that needs a person to step in is under <a {...linkProps(`/rooms/${roomId}/decisions`)}>Waiting on you</a>.
          </p>
        </section>
      )}
    </>
  );
}

import type { AgentType, AgentView } from '../../../shared/app-types';
import { Light } from '../../components/ui';
import { relative } from '../../lib/format';
import { linkProps } from '../../lib/router';
import { RelTime, useNow } from './strip-now';

const TYPE_LABEL: Record<AgentType, string> = { muse: 'Muse', instinct: 'Instinct', other: 'Other', stand_in: 'Stand-in' };
const TYPE_NOUN: Record<AgentType, string> = { muse: 'Muse', instinct: 'Instinct', other: 'agent', stand_in: 'stand-in' };

/** "Your Muse", "Sam's Instinct": whose agent it is and what kind, in one small label. */
function whose(a: AgentView): string {
  return `${a.is_mine ? 'Your' : `${a.owner_name}'s`} ${TYPE_NOUN[a.type] ?? 'agent'}`;
}

/** "Next due in 34 min", "Was due 2 h ago", "Paused, no check-in expected". */
function Due({ a, short }: { a: AgentView; short?: boolean }) {
  const now = useNow();
  const overdue = !!a.next_due_at && new Date(a.next_due_at).getTime() < now;
  if (a.paused) return <>{short ? 'paused' : 'Paused, no check-in expected'}</>;
  if (!a.next_due_at) return <>{short ? 'not scheduled' : 'No check-in scheduled'}</>;
  return (
    <>
      {short ? (overdue ? 'was due' : 'due') : overdue ? 'Was due' : 'Next due'} <RelTime iso={a.next_due_at} />
    </>
  );
}

/** The times line as plain words, for the tooltip when the line is cut short. */
function timesText(a: AgentView, now: number): string {
  const overdue = !!a.next_due_at && new Date(a.next_due_at).getTime() < now;
  const due = a.paused ? 'Paused, no check-in expected' : a.next_due_at ? `${overdue ? 'Was due' : 'Next due'} ${relative(a.next_due_at, now)}` : 'No check-in scheduled';
  const last = a.last_checkin_at ? `last check-in ${relative(a.last_checkin_at, now)}` : 'no check-in yet';
  return `${due} · ${last}`;
}

function LastCheckIn({ a, lower }: { a: AgentView; lower?: boolean }) {
  return a.last_checkin_at ? (
    <>
      {lower ? 'last' : 'Last'} check-in <RelTime iso={a.last_checkin_at} />
    </>
  ) : (
    <>{lower ? 'no' : 'No'} check-in yet</>
  );
}

/**
 * One agent in the strip on a wide screen, in three short lines: the light, name, owner and kind;
 * why the light is that colour; when it is next due and when it last checked in. Only the owner can
 * open the agent's page; everyone can read the reason (the full text is also in the tooltip).
 */
export function AgentTile({ agent: a }: { agent: AgentView }) {
  const now = useNow();
  const body = (
    <>
      <span className="name">
        <Light light={a.status} title={a.status_reason || undefined} />
        <span className="truncate strip-name">{a.name}</span>
        <span className="pill strip-type" title={`Owner: ${a.owner_name}${a.is_mine ? ' (you)' : ''}`}>
          {whose(a)}
        </span>
      </span>
      <span className="strip-reason small muted">{a.status_reason}</span>
      <span className="strip-times tiny" title={timesText(a, now)}>
        <Due a={a} />
        <span aria-hidden="true"> · </span>
        <LastCheckIn a={a} lower />
      </span>
    </>
  );

  return (
    <div role="listitem" className="strip-item">
      {a.is_mine ? (
        <a className="agent-tile strip-tile strip-tile-link" data-light={a.status} title={a.status_reason} {...linkProps(`/agents/${a.id}`)}>
          {body}
        </a>
      ) : (
        <div className="agent-tile strip-tile" data-light={a.status} title={a.status_reason}>
          {body}
        </div>
      )}
    </div>
  );
}

/** One agent on a phone: a single row (light, name, when it is due). Tap it to see the rest. */
export function AgentChip({ agent: a, open, onToggle }: { agent: AgentView; open: boolean; onToggle: () => void }) {
  return (
    <div role="listitem" className="strip-item">
      <button
        type="button"
        className={`strip-chip${open ? ' open' : ''}`}
        data-light={a.status}
        aria-expanded={open}
        aria-controls="strip-detail"
        onClick={onToggle}
        title={a.status_reason}
      >
        <Light light={a.status} title={a.status_reason || undefined} />
        <span className="strip-chip-name">{a.name}</span>
        <span className="strip-chip-due tiny muted">
          <Due a={a} short />
        </span>
      </button>
    </div>
  );
}

/** Everything about one agent, under the row of chips on a phone. */
export function AgentDetail({ agent: a, onClose }: { agent: AgentView; onClose: () => void }) {
  return (
    <div id="strip-detail" className="strip-detail" data-light={a.status} role="region" aria-label={`About ${a.name}`}>
      <div className="strip-detail-head">
        <span className="name">
          <Light light={a.status} title={a.status_reason || undefined} />
          <strong className="truncate">{a.name}</strong>
          <span className="pill strip-type">{TYPE_LABEL[a.type] ?? 'Other'}</span>
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="small strip-detail-reason">{a.status_reason}</p>
      <p className="tiny muted strip-detail-times">
        <span>
          <LastCheckIn a={a} />
        </span>
        <span>
          <Due a={a} />
        </span>
        <span>
          Owner: {a.owner_name}
          {a.is_mine ? ' (you)' : ''}
        </span>
      </p>
      {a.is_mine && (
        <a className="small" {...linkProps(`/agents/${a.id}`)}>
          Open {a.name}'s page
        </a>
      )}
    </div>
  );
}

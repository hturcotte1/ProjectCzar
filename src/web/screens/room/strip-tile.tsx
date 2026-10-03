import type { AgentType, AgentView } from '../../../shared/app-types';
import { Light } from '../../components/ui';
import { linkProps } from '../../lib/router';
import { RelTime, useNow } from './strip-now';

const TYPE_LABEL: Record<AgentType, string> = { muse: 'Muse', instinct: 'Instinct', other: 'Other', stand_in: 'Stand-in' };

/** One agent in the strip. Only the owner can open the agent's page; everyone can read the reason. */
export function AgentTile({ agent: a }: { agent: AgentView }) {
  const now = useNow();
  const overdue = !!a.next_due_at && new Date(a.next_due_at).getTime() < now;

  const body = (
    <>
      <span className="name">
        <Light light={a.status} title={a.status_reason || undefined} />
        <span className="truncate">{a.name}</span>
        <span className="pill strip-type">{TYPE_LABEL[a.type] ?? 'Other'}</span>
      </span>
      <span className="strip-reason small muted">{a.status_reason}</span>
      <span className="strip-times tiny">
        <span>{a.last_checkin_at ? <>Last check-in <RelTime iso={a.last_checkin_at} /></> : 'No check-in yet'}</span>
        <span>
          {a.paused ? (
            'Paused, no check-in expected'
          ) : a.next_due_at ? (
            <>{overdue ? 'Was due' : 'Next due'} <RelTime iso={a.next_due_at} /></>
          ) : (
            'No check-in scheduled'
          )}
        </span>
      </span>
      <span className="strip-owner tiny faint truncate">Owner: {a.owner_name}{a.is_mine ? ' (you)' : ''}</span>
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

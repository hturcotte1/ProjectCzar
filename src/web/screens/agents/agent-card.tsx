import type { AgentView, RoomSummary } from '../../../shared/app-types';
import { Light, Pill, Time } from '../../components/ui';
import { relative } from '../../lib/format';
import { linkProps } from '../../lib/router';
import { TypePill, roomCount, roomNames } from './agent-common';

/** One agent in the list: its light, what it is, where it is and when it last checked in. */
export function AgentCard({ agent, rooms }: { agent: AgentView; rooms: RoomSummary[] }) {
  return (
    <article className="card ag-card">
      <div className="ag-card-head">
        <Light light={agent.status} large />
        <a className="ag-name truncate" {...linkProps(`/agents/${agent.id}`)}>
          {agent.name}
        </a>
        <TypePill type={agent.type} />
        {agent.paused && <Pill tone="amber">Paused</Pill>}
      </div>
      <p className="ag-reason">{agent.status_reason}</p>
      <dl className="kv ag-kv">
        <dt>Owner</dt>
        <dd>{agent.is_mine ? 'You' : agent.owner_name}</dd>
        <dt>Last check-in</dt>
        <dd>
          {agent.last_checkin_at ? (
            <>
              <Time iso={agent.last_checkin_at} /> <span className="faint">({relative(agent.last_checkin_at)})</span>
            </>
          ) : (
            'Not yet'
          )}
        </dd>
        <dt>Schedule</dt>
        <dd>{agent.schedule.text}</dd>
        <dt>Rooms</dt>
        <dd title={roomNames(agent, rooms)}>
          {roomCount(agent.room_ids.length)}
          {agent.room_ids.length > 0 && <span className="faint"> · {roomNames(agent, rooms)}</span>}
        </dd>
      </dl>
    </article>
  );
}

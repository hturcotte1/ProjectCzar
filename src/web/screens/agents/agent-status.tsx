import type { AgentView, RoomSummary } from '../../../shared/app-types';
import { LIGHT_WORDS, relative } from '../../lib/format';
import { Light, Pill, Time } from '../../components/ui';
import { TypePill, roomNames } from './agent-common';

function When({ iso, empty }: { iso: string | null; empty: string }) {
  if (!iso) return <>{empty}</>;
  return (
    <>
      <Time iso={iso} /> <span className="faint">({relative(iso)})</span>
    </>
  );
}

/** The top of an agent's page: how it is doing, when it last checked in and when it is next due. */
export function AgentStatus({ agent, rooms }: { agent: AgentView; rooms: RoomSummary[] }) {
  // "Off / not connected" would be wrong for an agent that is simply outside working hours, so a gray light
  // is described by its own reason ("Outside working hours") instead.
  const gray = agent.status === 'gray';
  const heading = gray ? agent.status_reason.replace(/\.$/, '') : LIGHT_WORDS[agent.status];
  return (
    <section className="card ag-status" aria-labelledby="ag-status-title">
      <div className="ag-status-head">
        <Light light={agent.status} large />
        <div className="ag-status-text">
          <div className="ag-status-title">
            <h2 id="ag-status-title">{heading}</h2>
            <TypePill type={agent.type} />
            {agent.paused && <Pill tone="amber">Paused</Pill>}
          </div>
          {!gray && (
            <p className="muted" style={{ margin: 0 }}>
              {agent.status_reason}
            </p>
          )}
        </div>
      </div>
      <dl className="kv ag-kv">
        <dt>Owner</dt>
        <dd>{agent.is_mine ? 'You' : agent.owner_name}</dd>
        <dt>Last check-in</dt>
        <dd>
          <When iso={agent.last_checkin_at} empty="Not yet" />
        </dd>
        <dt>Next check-in</dt>
        <dd>
          <When iso={agent.next_due_at} empty={agent.paused ? 'Paused, so none expected' : 'None expected right now'} />
        </dd>
        <dt>Last heard from</dt>
        <dd>
          <When iso={agent.last_seen_at} empty="Not yet" />
        </dd>
        <dt>Schedule</dt>
        <dd>{agent.schedule.text}</dd>
        <dt>Rooms</dt>
        <dd>{roomNames(agent, rooms)}</dd>
        {agent.description && (
          <>
            <dt>About</dt>
            <dd>{agent.description}</dd>
          </>
        )}
      </dl>
      {agent.is_mine && (
        <nav className="ag-jump" aria-label="On this page">
          <a href="#ag-connect" onClick={(e) => jump(e, 'ag-connect')}>
            Connect
          </a>
          <a href="#ag-keys" onClick={(e) => jump(e, 'ag-keys')}>
            Keys
          </a>
          <a href="#ag-schedule" onClick={(e) => jump(e, 'ag-schedule')}>
            Schedule
          </a>
          <a href="#ag-log-section" onClick={(e) => jump(e, 'ag-log-section')}>
            Connection log
          </a>
        </nav>
      )}
    </section>
  );
}

/** Scrolls to a section of the page without changing the address (the app's router owns it). */
function jump(e: React.MouseEvent, id: string): void {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

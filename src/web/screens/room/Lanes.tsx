import { useState } from 'react';
import type { InstructionView, Lane, RoomDetail } from '../../../shared/app-types';
import { Empty, Light } from '../../components/ui';
import { SafeText } from '../../components/SafeText';
import { LIGHT_WORDS } from '../../lib/format';
import { linkProps } from '../../lib/router';
import { CancelDialog } from './lanes-cancel';
import { InstructionItem } from './lanes-parts';
import { RelTime } from './strip-now';
import './room-b.css';

/** "Working on now": one lane per agent with its latest work, open instructions and waiting questions. */
export function Lanes({ detail }: { detail: RoomDetail }) {
  const [cancelling, setCancelling] = useState<InstructionView | null>(null);
  // Instructions cancelled here show as cancelled right away, before the room refreshes.
  const [cancelled, setCancelled] = useState<Set<string>>(() => new Set());

  if (detail.lanes.length === 0) {
    return (
      <Empty>
        No agents in this room yet. Add one from <a {...linkProps('/agents')}>Agents</a>.
      </Empty>
    );
  }

  return (
    <section aria-label="Working on now" className="stack">
      <h2>Working on now</h2>
      <div className="lanes">
        {detail.lanes.map((lane) => (
          <LaneCard key={lane.agent_id} lane={lane} cancelled={cancelled} onCancel={setCancelling} />
        ))}
      </div>
      {cancelling && (
        <CancelDialog
          instruction={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelled((s) => new Set(s).add(cancelling.id));
            setCancelling(null);
          }}
        />
      )}
    </section>
  );
}

function LaneCard({ lane, cancelled, onCancel }: { lane: Lane; cancelled: Set<string>; onCancel: (ins: InstructionView) => void }) {
  return (
    <article className="lane" aria-label={`${lane.agent_name}'s lane`}>
      <header className="row-between lane-head">
        <h3 className="row" style={{ gap: 8, minWidth: 0 }}>
          <Light light={lane.status} />
          <span className="truncate">{lane.agent_name}</span>
        </h3>
        <span className="tiny muted">{LIGHT_WORDS[lane.status]}</span>
      </header>

      {lane.blocked && (
        <div className="lane-blocked" role="status">
          <strong>Blocked</strong>
          <div>
            <SafeText text={lane.blocked.reason} />
          </div>
          {lane.blocked.what_would_unblock && (
            <div className="lane-unblock">
              <span className="lane-label">What would unblock it</span>
              <SafeText text={lane.blocked.what_would_unblock} />
            </div>
          )}
        </div>
      )}

      <div>
        <h4 className="lane-label">Working on</h4>
        {lane.working_on ? (
          <>
            <div className="lane-working">
              <SafeText text={lane.working_on} />
            </div>
            <div className="tiny faint">
              Updated <RelTime iso={lane.working_on_at} />
            </div>
          </>
        ) : (
          <div className="muted small">Has not said what it is working on yet.</div>
        )}
      </div>

      <div>
        <h4 className="lane-label">Instructions{lane.instructions.length > 0 ? ` (${lane.instructions.length})` : ''}</h4>
        {lane.instructions.length === 0 ? (
          <div className="muted small">Nothing open.</div>
        ) : (
          <ul className="lane-list">
            {lane.instructions.map((ins) => (
              <InstructionItem key={ins.id} ins={ins} cancelled={cancelled.has(ins.id)} onCancel={onCancel} />
            ))}
          </ul>
        )}
      </div>

      {lane.questions_waiting.length > 0 && (
        <div>
          <h4 className="lane-label">Questions waiting on {lane.agent_name}</h4>
          <ul className="lane-list">
            {lane.questions_waiting.map((q) => (
              <li key={q.id} className="lane-ins">
                <div className="tiny faint">
                  {q.asker_name} asked <RelTime iso={q.created_at} />
                </div>
                <div className="lane-ins-text">
                  <SafeText text={q.text} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

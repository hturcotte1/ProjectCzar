import type { AgentView } from '../../../shared/app-types';
import { linkProps } from '../../lib/router';
import { AgentTile } from './strip-tile';
import './room-b.css';

/** One tile per agent: status light, last check-in, next one due and owner. Scrolls sideways on phones. */
export function AgentStrip({ agents }: { agents: AgentView[] }) {
  if (agents.length === 0) {
    return (
      <div className="agent-strip strip-empty">
        <span className="muted small">
          No agents yet. Add one from <a {...linkProps('/agents')}>Agents</a>.
        </span>
      </div>
    );
  }
  return (
    <div className="agent-strip" role="list" aria-label="Agents in this room">
      {agents.map((a) => (
        <AgentTile key={a.id} agent={a} />
      ))}
    </div>
  );
}

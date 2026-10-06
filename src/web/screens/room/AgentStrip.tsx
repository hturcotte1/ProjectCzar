import { useState } from 'react';
import type { AgentView } from '../../../shared/app-types';
import { PHONE_QUERY, useMediaQuery } from '../../lib/media';
import { linkProps } from '../../lib/router';
import { AgentChip, AgentDetail, AgentTile } from './strip-tile';
import './room-b.css';

/**
 * One tile per agent: status light, why, last check-in, next one due and owner. On a phone each
 * agent is a one-row chip instead, so the feed keeps most of the screen; tapping a chip shows the
 * rest underneath. Both scroll sideways when there are more agents than fit.
 */
export function AgentStrip({ agents }: { agents: AgentView[] }) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [openId, setOpenId] = useState<string | null>(null);
  if (agents.length === 0) {
    return (
      <div className="agent-strip strip-empty">
        <span className="muted small">
          No agents yet. Add one from <a {...linkProps('/agents')}>Agents</a>.
        </span>
      </div>
    );
  }
  if (phone) {
    const open = agents.find((a) => a.id === openId) ?? null;
    return (
      <div className="strip-phone">
        <div className="agent-strip strip-chips" role="list" aria-label="Agents in this room (tap one for details)">
          {agents.map((a) => (
            <AgentChip key={a.id} agent={a} open={open?.id === a.id} onToggle={() => setOpenId(open?.id === a.id ? null : a.id)} />
          ))}
        </div>
        {open && <AgentDetail agent={open} onClose={() => setOpenId(null)} />}
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

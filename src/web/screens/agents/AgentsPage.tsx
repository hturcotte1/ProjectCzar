import { useState } from 'react';
import type { AgentView, SecretsView } from '../../../shared/app-types';
import { ErrorBanner, Empty } from '../../components/ui';
import { api } from '../../lib/api';
import { useLive } from '../../lib/live';
import { useMe } from '../../lib/me';
import { navigate } from '../../lib/router';
import { AddAgentForm } from './agent-form';
import { AgentCard } from './agent-card';
import { useLoaded, useTick } from './hooks';
import { SecretsPanel } from './secrets-panel';
import './agents.css';

export function AgentsPage() {
  const { me } = useMe();
  const { data: agents, error, loading, reload } = useLoaded(() => api.get<AgentView[]>('/agents'));
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<SecretsView | null>(null);
  useTick();

  useLive((e) => {
    if (e.type === 'agent' || e.type === 'rooms' || e.type === 'reconnected' || e.type === 'poll') void reload();
  });

  const mine = (agents ?? []).filter((a) => a.is_mine);
  const others = (agents ?? []).filter((a) => !a.is_mine);

  return (
    <div className="stack ag-page">
      <div className="row-between">
        <p className="muted" style={{ margin: 0, maxWidth: '54ch' }}>
          Agents are the AI assistants that check in here. You look after your own; you can see the others that share a room with you.
        </p>
        {!adding && !created && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            Add an agent
          </button>
        )}
      </div>

      {created && (
        <SecretsPanel
          secrets={created}
          title={`${created.agent.name} is ready to connect`}
          showMessages
          onDone={() => setCreated(null)}
          onOpen={() => navigate(`/agents/${created.agent.id}`)}
        />
      )}

      {adding && (
        <AddAgentForm
          rooms={me.rooms}
          onCancel={() => setAdding(false)}
          onCreated={(s) => {
            setAdding(false);
            setCreated(s);
            void reload();
          }}
        />
      )}

      {error && !agents ? <ErrorBanner error={error} /> : null}
      {loading && !agents && <div className="muted">Loading agents…</div>}

      {agents && (
        <section className="section" aria-labelledby="ag-mine-title">
          <h2 id="ag-mine-title">Your agents</h2>
          {mine.length === 0 ? (
            <Empty>You have no agents yet. Choose “Add an agent” to connect your first one.</Empty>
          ) : (
            <div className="ag-list" aria-live="polite">
              {mine.map((a) => (
                <AgentCard key={a.id} agent={a} rooms={me.rooms} />
              ))}
            </div>
          )}
        </section>
      )}

      {agents && others.length > 0 && (
        <section className="section" aria-labelledby="ag-others-title">
          <h2 id="ag-others-title">Other agents you can see</h2>
          <div className="ag-list">
            {others.map((a) => (
              <AgentCard key={a.id} agent={a} rooms={me.rooms} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

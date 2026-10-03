import { useEffect, useState, type ReactNode } from 'react';
import type { AgentView, JoinView, SecretsView } from '../../../shared/app-types';
import { ErrorBanner } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useLive } from '../../lib/live';
import { useMe } from '../../lib/me';
import { linkProps } from '../../lib/router';
import { AgentConnect } from './agent-connect';
import { AgentKeys } from './agent-keys';
import { AgentManage } from './agent-manage';
import { AgentSchedule } from './agent-schedule';
import { AgentStatus } from './agent-status';
import { ConnectionLog } from './connection-log';
import { useLoaded, useTick } from './hooks';
import { SecretsPanel } from './secrets-panel';
import './agents.css';

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="card ag-section" id={id} aria-labelledby={`${id}-title`}>
      <div className="stack">
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
          {intro && (
            <p className="muted small" style={{ margin: '4px 0 0' }}>
              {intro}
            </p>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}

export function AgentDetailPage({ agentId }: { agentId: string }) {
  // Keyed so that moving from one agent to another never shows the first one's secrets or drafts.
  return <AgentDetail key={agentId} agentId={agentId} />;
}

function AgentDetail({ agentId }: { agentId: string }) {
  const { me } = useMe();
  const { data: agent, error, loading, reload: reloadAgent } = useLoaded(() => api.get<AgentView>(`/agents/${agentId}`), [agentId]);
  const mine = agent?.is_mine ?? false;
  const { data: join, reload: reloadJoin } = useLoaded(() => (mine ? api.get<JoinView>(`/agents/${agentId}/join`) : Promise.resolve(null)), [agentId, mine]);
  const [secrets, setSecrets] = useState<SecretsView | null>(null);
  useTick();

  const reloadAll = () => {
    void reloadAgent();
    void reloadJoin();
  };

  useLive((e) => {
    if (e.type === 'agent' && e.agent_id === agentId) reloadAll();
    else if (e.type === 'poll') void reloadAgent();
    else if (e.type === 'reconnected') reloadAll();
  });

  useEffect(() => {
    document.title = agent ? `${agent.name} · Tempo` : 'Agent · Tempo';
    return () => {
      document.title = 'Tempo';
    };
  }, [agent?.name]);

  if (error && !agent) {
    const gone = error instanceof ApiError && error.status === 404;
    return (
      <div className="stack">
        <ErrorBanner error={error} />
        <div>
          <a className="btn" {...linkProps('/agents')}>
            {gone ? 'Back to all agents' : 'Back'}
          </a>
        </div>
      </div>
    );
  }
  if (loading || !agent) return <div className="muted">Loading agent…</div>;

  return (
    <div className="stack ag-page">
      <div className="ag-head">
        <a className="small" {...linkProps('/agents')}>
          ← All agents
        </a>
        <h2 className="ag-title">{agent.name}</h2>
      </div>

      {secrets && (
        <SecretsPanel
          secrets={secrets}
          title={secrets.api_key ? 'Your new key' : 'Your new page link'}
          showMessages={!!secrets.page_link}
          onDone={() => setSecrets(null)}
        />
      )}

      <AgentStatus agent={agent} rooms={me.rooms} />

      {!agent.is_mine && (
        <div className="banner banner-info" role="note">
          <span>{agent.owner_name} looks after this agent, so only they can change it or see how it connects.</span>
        </div>
      )}

      {agent.is_mine && (
        <>
          <Section id="ag-connect" title="Connect your agent" intro="Copy these messages and send them to your agent yourself. Real names, rooms and times are already filled in.">
            {join ? <AgentConnect join={join} /> : <div className="muted">Loading the messages…</div>}
          </Section>

          <Section id="ag-keys" title="Keys" intro="Secrets are never shown again after they are made. If one is lost or leaks, make a new one: the old one stops working at once.">
            <AgentKeys agent={agent} onSecrets={setSecrets} onChanged={reloadAll} />
          </Section>

          <Section id="ag-schedule" title="Check-in schedule">
            <AgentSchedule key={JSON.stringify(agent.schedule)} agent={agent} onSaved={reloadAll} />
          </Section>

          <Section id="ag-log-section" title="Connection log">
            <ConnectionLog agentId={agent.id} />
          </Section>

          <Section id="ag-manage" title="Manage this agent">
            <AgentManage agent={agent} onChanged={reloadAll} />
          </Section>
        </>
      )}
    </div>
  );
}

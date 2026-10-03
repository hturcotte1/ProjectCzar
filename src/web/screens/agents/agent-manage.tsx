import { useState } from 'react';
import type { AgentView } from '../../../shared/app-types';
import { ErrorBanner, useAction, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { navigate } from '../../lib/router';
import { ConfirmDialog } from './confirm';

function NameForm({ agent, onSaved }: { agent: AgentView; onSaved: () => void }) {
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const dirty = name.trim() !== agent.name || description.trim() !== agent.description;

  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.patch(`/agents/${agent.id}`, { name: name.trim(), description: description.trim() });
          toast('Saved.');
          onSaved();
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <ErrorBanner error={error} />
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="ag-rename">Name</label>
        <input id="ag-rename" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoComplete="off" />
        <span className="hint">Other agents use this name to talk to it. If you change it, tell your agent its new name.</span>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="ag-about">What does it do?</label>
        <input id="ag-about" className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
      </div>
      <div>
        <button className="btn" disabled={busy || !dirty || !name.trim()}>
          {busy ? 'Saving…' : 'Save name'}
        </button>
      </div>
    </form>
  );
}

/** Pause or resume, rename, and remove the agent. */
export function AgentManage({ agent, onChanged }: { agent: AgentView; onChanged: () => void }) {
  const { busy, run } = useAction();
  const [removing, setRemoving] = useState(false);

  const togglePause = async () => {
    const ok = await run(() => api.patch(`/agents/${agent.id}`, { paused: !agent.paused }), agent.paused ? `${agent.name} is checking in again.` : `${agent.name} is paused.`);
    if (ok !== undefined) onChanged();
  };

  const remove = async () => {
    const ok = await run(() => api.del(`/agents/${agent.id}`), `${agent.name} was removed.`);
    if (ok !== undefined) navigate('/agents');
  };

  return (
    <div className="stack">
      <div className="ag-manage-row">
        <div>
          <h3>{agent.paused ? 'Paused' : 'Pause this agent'}</h3>
          <p className="muted small" style={{ margin: '2px 0 0' }}>
            {agent.paused
              ? 'No check-ins are expected, so it will not raise alerts. Resume when it is ready.'
              : 'Use this when the agent is switched off on purpose, so its light does not turn red and nobody gets alerts.'}
          </p>
        </div>
        <button type="button" className="btn" onClick={() => void togglePause()} disabled={busy}>
          {agent.paused ? 'Resume check-ins' : 'Pause check-ins'}
        </button>
      </div>
      <hr className="divider" style={{ margin: 0 }} />
      <NameForm key={`${agent.name}|${agent.description}`} agent={agent} onSaved={onChanged} />
      <hr className="divider" style={{ margin: 0 }} />
      <div className="ag-manage-row">
        <div>
          <h3>Remove this agent</h3>
          <p className="muted small" style={{ margin: '2px 0 0' }}>
            Takes {agent.name} out of every room and turns off its key and page link. What it already posted stays in the rooms.
          </p>
        </div>
        <button type="button" className="btn btn-danger" onClick={() => setRemoving(true)} disabled={busy}>
          Remove agent…
        </button>
      </div>
      {removing && (
        <ConfirmDialog title={`Remove ${agent.name}?`} confirmLabel="Remove for good" danger busy={busy} requireText={agent.name} onConfirm={() => void remove()} onCancel={() => setRemoving(false)}>
          <p>
            <strong>{agent.name}</strong> will leave every room, and its key and page link stop working right away.
          </p>
          <p className="muted small">This cannot be undone. To use the same assistant again you would add it as a new agent and connect it again.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

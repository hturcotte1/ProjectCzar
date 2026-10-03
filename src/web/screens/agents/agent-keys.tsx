import { useState } from 'react';
import type { AgentView, SecretsView } from '../../../shared/app-types';
import { Time, useAction } from '../../components/ui';
import { api } from '../../lib/api';
import { ConfirmDialog } from './confirm';

type Kind = 'api' | 'page';
type Pending = { kind: Kind; action: 'rotate' | 'revoke' } | null;

interface KeyFacts {
  kind: Kind;
  title: string;
  about: string;
  hint: string | null;
  created: string | null;
  lastUsed: string | null;
}

function KeyRow({ k, busy, onRotate, onRevoke }: { k: KeyFacts; busy: boolean; onRotate: () => void; onRevoke: () => void }) {
  return (
    <div className="ag-key">
      <div className="ag-key-main">
        <h3>{k.title}</h3>
        <p className="muted small" style={{ margin: '2px 0 6px' }}>
          {k.about}
        </p>
        {k.hint ? (
          <dl className="kv ag-kv">
            <dt>Current</dt>
            <dd>
              <code>{k.hint}</code> <span className="faint">(only the end is shown)</span>
            </dd>
            <dt>Made</dt>
            <dd>
              <Time iso={k.created} />
            </dd>
            <dt>Last used</dt>
            <dd>{k.lastUsed ? <Time iso={k.lastUsed} /> : 'Never used'}</dd>
          </dl>
        ) : (
          <p className="small ag-off">Turned off. Nothing can use this right now.</p>
        )}
      </div>
      <div className="row ag-key-actions">
        <button type="button" className="btn" onClick={onRotate} disabled={busy}>
          {k.hint ? (k.kind === 'api' ? 'Make a new key' : 'Make a new link') : k.kind === 'api' ? 'Make a key' : 'Make a link'}
        </button>
        {k.hint && (
          <button type="button" className="btn btn-danger" onClick={onRevoke} disabled={busy}>
            Turn off
          </button>
        )}
      </div>
    </div>
  );
}

/** The agent's two secrets: the key (Muse and others) and the private page link (Instinct). */
export function AgentKeys({ agent, onSecrets, onChanged }: { agent: AgentView; onSecrets: (s: SecretsView) => void; onChanged: () => void }) {
  const [pending, setPending] = useState<Pending>(null);
  const { busy, run } = useAction();
  const keys = agent.keys;
  const isPage = pending?.kind === 'page';
  const instinct = agent.type === 'instinct';
  const noun = isPage ? 'link' : 'key';
  const hasCurrent = !!(isPage ? keys?.page_hint : keys?.api_hint);

  const confirm = async () => {
    if (!pending) return;
    const { kind, action } = pending;
    const done = await run(async () => {
      if (action === 'rotate') {
        const secrets = await api.post<SecretsView>(`/agents/${agent.id}/keys/rotate`, { kind });
        onSecrets(secrets);
      } else {
        await api.post(`/agents/${agent.id}/keys/revoke`, { kind });
      }
      return true;
    }, action === 'rotate' ? undefined : kind === 'api' ? 'The key is turned off.' : 'The page link is turned off.');
    if (done) {
      setPending(null);
      onChanged();
    }
  };

  return (
    <div className="stack">
      <KeyRow
        k={{
          kind: 'api',
          title: 'Key',
          about: instinct ? "Instinct doesn't use this; it opens its private page link instead." : "The agent's password for Tempo. Enter it only in the agent's secure credential prompt, never in chat.",
          hint: keys?.api_hint ?? null,
          created: keys?.api_created_at ?? null,
          lastUsed: keys?.api_last_used_at ?? null,
        }}
        busy={busy}
        onRotate={() => setPending({ kind: 'api', action: 'rotate' })}
        onRevoke={() => setPending({ kind: 'api', action: 'revoke' })}
      />
      <hr className="divider" style={{ margin: 0 }} />
      <KeyRow
        k={{
          kind: 'page',
          title: 'Private page link',
          about: instinct
            ? 'The web page Instinct opens to check in. Anyone with the link can check in as this agent, so keep it private.'
            : "Not needed for this kind of agent. It is only used by agents that open a web page, so it's safe to turn off.",
          hint: keys?.page_hint ?? null,
          created: keys?.page_created_at ?? null,
          lastUsed: keys?.page_last_used_at ?? null,
        }}
        busy={busy}
        onRotate={() => setPending({ kind: 'page', action: 'rotate' })}
        onRevoke={() => setPending({ kind: 'page', action: 'revoke' })}
      />

      {pending && (
        <ConfirmDialog
          title={
            pending.action === 'rotate'
              ? isPage
                ? `Make a new page link for ${agent.name}?`
                : `Make a new key for ${agent.name}?`
              : isPage
                ? `Turn off the page link for ${agent.name}?`
                : `Turn off the key for ${agent.name}?`
          }
          confirmLabel={pending.action === 'rotate' ? (isPage ? 'Make a new link' : 'Make a new key') : 'Turn it off now'}
          danger={pending.action === 'revoke'}
          busy={busy}
          onConfirm={() => void confirm()}
          onCancel={() => setPending(null)}
        >
          {pending.action === 'rotate' ? (
            <>
              <p>
                {hasCurrent ? `The current ${noun} stops working the moment you continue. ` : ''}
                Tempo shows the new {noun} only once, so have somewhere ready to copy it.
              </p>
              <p className="muted small">{agent.name} cannot check in until you give it the new {noun}.</p>
            </>
          ) : (
            <p>
              This stops working <strong>immediately</strong>. {agent.name} will not be able to check in with it, and the light will turn red after missed check-ins. You can make a new {noun} later.
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}

import { useEffect, useRef } from 'react';
import type { SecretsView } from '../../../shared/app-types';
import { CopyButton } from '../../components/ui';
import { JoinMessagesPanel } from './join-panel';

function Secret({ label, value, copyLabel, note }: { label: string; value: string; copyLabel: string; note: string }) {
  return (
    <div className="ag-secret">
      <div className="row-between">
        <span className="label">{label}</span>
        <CopyButton text={value} label={copyLabel} />
      </div>
      <code className="ag-secret-value" tabIndex={0} aria-label={label}>
        {value}
      </code>
      <p className="muted small" style={{ margin: 0 }}>
        {note}
      </p>
    </div>
  );
}

/**
 * Shown once, right after an agent is created or a key / page link is made new.
 * Tempo cannot show these secrets again, so this panel stays open until the person closes it.
 */
export function SecretsPanel({
  secrets,
  title,
  showMessages,
  onDone,
  doneLabel = "I've saved these",
  openLabel,
  onOpen,
}: {
  secrets: SecretsView;
  title: string;
  /** Include the join messages (they hold the real page link when one was just made). */
  showMessages: boolean;
  onDone: () => void;
  doneLabel?: string;
  openLabel?: string;
  onOpen?: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, []);
  const instinct = secrets.agent.type === 'instinct';

  return (
    <section className="card ag-save" ref={ref} tabIndex={-1} aria-labelledby="ag-save-title">
      <div className="stack">
        <div>
          <h2 id="ag-save-title">{title}</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Save these now. Tempo shows them only once and cannot show them again. If one gets lost, you can make a new one on the agent's page.
          </p>
        </div>

        {secrets.api_key && (
          <Secret
            label="API key"
            value={secrets.api_key}
            copyLabel="Copy key"
            note={`Enter it in your agent's secure credential prompt, never in chat. It won't be shown again.${instinct ? ' Instinct itself checks in through its private page link, so it does not need this key.' : ''}`}
          />
        )}
        {secrets.page_link && (instinct || !secrets.api_key) && (
          <Secret
            label="Private page link"
            value={secrets.page_link}
            copyLabel="Copy link"
            note={`This link is a secret too: anyone who has it can check in as ${secrets.agent.name}. ${instinct ? 'It is already inside the messages below.' : 'Muse and other agents use the key, not this link.'}`}
          />
        )}

        {showMessages && (
          <>
            <hr className="divider" style={{ margin: 0 }} />
            <JoinMessagesPanel messages={secrets.messages} />
          </>
        )}

        <div className="row">
          {onOpen && (
            <button type="button" className="btn btn-primary" onClick={onOpen}>
              {openLabel ?? `Go to ${secrets.agent.name}`}
            </button>
          )}
          <button type="button" className={onOpen ? 'btn' : 'btn btn-primary'} onClick={onDone}>
            {doneLabel}
          </button>
        </div>
      </div>
    </section>
  );
}

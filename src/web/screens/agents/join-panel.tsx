import { useState, type ReactNode } from 'react';
import type { JoinMessagesView } from '../../../shared/app-types';
import { CopyButton } from '../../components/ui';
import { typeNoun } from './agent-common';

/**
 * The ready-to-send messages for one agent, with the real names, rooms and times already filled in.
 * Used on the agent's page and in the one-time "Save these now" panel after creating or rotating.
 */

function CopyBlock({ title, help, text, label, id }: { title: string; help?: ReactNode; text: string; label: string; id: string }) {
  return (
    <section className="ag-block" aria-labelledby={id}>
      <div className="row-between">
        <h3 id={id}>{title}</h3>
        <CopyButton text={text} label={label} />
      </div>
      {help && <p className="muted small ag-help">{help}</p>}
      <pre className="copyable" tabIndex={0} aria-label={title}>
        {text}
      </pre>
    </section>
  );
}

/** Notes for the owner (not for the agent) as a small checklist to tick off. */
function OwnerNotes({ notes }: { notes: string[] }) {
  const [done, setDone] = useState<Record<number, boolean>>({});
  if (!notes.length) return null;
  return (
    <section className="ag-notes" aria-labelledby="ag-notes-title">
      <h3 id="ag-notes-title">A few things to do yourself</h3>
      <p className="muted small ag-help">These are for you, not for the agent. Tick them off as you go.</p>
      <ul className="ag-checklist">
        {notes.map((note, i) => (
          <li key={i}>
            <label className={`check${done[i] ? ' ag-done' : ''}`}>
              <input type="checkbox" checked={!!done[i]} onChange={() => setDone((d) => ({ ...d, [i]: !d[i] }))} />
              <span>{note}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function JoinMessagesPanel({ messages }: { messages: JoinMessagesView }) {
  const noun = typeNoun(messages.agent_type);
  const instinct = messages.agent_type === 'instinct';
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>
        Check-ins: <strong>{messages.schedule_text}</strong>
      </p>

      {messages.link_is_placeholder && (
        <div className="banner banner-warn" role="note">
          <span>
            The private page link inside this message is only a placeholder: Tempo shows the real link just once, when it is made. To get a message with the real link, make a new page link in the Keys section below.
          </span>
        </div>
      )}

      <CopyBlock
        id="ag-join-title"
        title={`Send this to ${noun}`}
        label="Copy message"
        text={messages.join_message}
        help={
          instinct
            ? 'Send it yourself in your usual chat with Instinct. It is long on purpose: it tells Instinct how to check in and what it may do.'
            : `Paste it into your own chat with ${noun}. It never contains the key: ${noun} will ask for that separately.`
        }
      />

      <OwnerNotes notes={messages.owner_notes} />

      {messages.scheduled_text && (
        <div className="stack-sm">
          <CopyBlock
            id="ag-sched-text-title"
            title="The short text that triggers each check-in"
            label="Copy text"
            text={messages.scheduled_text}
            help="Send this to Instinct at each check-in time. The link is inside it."
          />
          {messages.scheduled_text_tip && <p className="ag-tip small">{messages.scheduled_text_tip}</p>}
        </div>
      )}

      <CopyBlock
        id="ag-rearm-title"
        title={`If ${noun} goes quiet`}
        label="Copy reminder"
        text={messages.rearm_message}
        help={`Send this when the light turns red or ${noun} stops checking in. It contains no secrets.`}
      />
    </div>
  );
}

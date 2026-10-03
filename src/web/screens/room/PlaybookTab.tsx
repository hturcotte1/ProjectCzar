import { useId, useMemo, useState } from 'react';
import type { PlaybookEntryView } from '../../../shared/app-types';
import { api } from '../../lib/api';
import { Dialog, Empty, ErrorBanner, Pill, Time, useAction } from '../../components/ui';
import { SafeText } from '../../components/SafeText';
import { useRoomData } from './conductor-load';
import './room-c.css';

const MAX_TITLE = 200;
const MAX_BODY = 2000;

/**
 * Playbook: short lessons the team (and its agents) have learned. Anyone in the room can add,
 * edit or remove a lesson; agents and the Conductor add their own too.
 */
export function PlaybookTab({ roomId }: { roomId: string }) {
  const { data, error, reload } = useRoomData<PlaybookEntryView[]>(`/rooms/${roomId}/playbook`, (e) => (e.type === 'feed' && e.room_id === roomId && e.event.kind === 'playbook') || (e.type === 'room' && e.room_id === roomId && e.what === 'playbook'));
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('');
  const filterId = useId();

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!data || !q) return data;
    return data.filter((p) => p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q));
  }, [data, filter]);

  return (
    <div className="c-page stack" style={{ gap: 16 }}>
      <header className="row-between c-head">
        <div style={{ minWidth: 0, flex: '1 1 260px' }}>
          <h2>Playbook</h2>
          <p className="c-intro">Lessons this room has learned, so everyone does things the same way next time. Anyone here can add or edit them, and agents add lessons too.</p>
        </div>
        {!adding && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            Add a lesson
          </button>
        )}
      </header>

      <ErrorBanner error={error} />

      {adding && (
        <section className="card" aria-label="Add a lesson">
          <LessonForm
            submitLabel="Save lesson"
            onCancel={() => setAdding(false)}
            onSave={async (title, body) => {
              await api.post(`/rooms/${roomId}/playbook`, { title, body });
              await reload();
              setAdding(false);
            }}
            successText="Lesson saved"
          />
        </section>
      )}

      {data && data.length > 6 && (
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor={filterId}>Find a lesson</label>
          <input id={filterId} className="input" type="search" value={filter} placeholder="Type a word to search" onChange={(e) => setFilter(e.target.value)} />
        </div>
      )}

      <div aria-live="polite">
        {data === null && !error && <p className="muted">Loading the playbook…</p>}
        {data && data.length === 0 && !adding && (
          <Empty>
            <p style={{ margin: 0 }}>No lessons yet.</p>
            <p className="small faint" style={{ margin: '4px 0 0' }}>
              When something works well, or goes wrong, write it down here so nobody has to learn it twice.
            </p>
          </Empty>
        )}
        {shown && shown.length === 0 && data && data.length > 0 && <Empty>No lessons match "{filter}".</Empty>}
        {shown && shown.length > 0 && (
          <ul className="c-lessons">
            {shown.map((p) => (
              <Lesson key={p.id} entry={p} onChanged={reload} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Lesson({ entry, onChanged }: { entry: PlaybookEntryView; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { busy, run } = useAction();
  const edited = entry.updated_at !== entry.created_at;
  const by = entry.author_kind === 'conductor' ? 'the Conductor' : entry.author_name;

  if (editing) {
    return (
      <li className="card">
        <LessonForm
          initial={entry}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSave={async (title, body) => {
            await api.patch(`/playbook/${entry.id}`, { title, body });
            await onChanged();
            setEditing(false);
          }}
          successText="Lesson updated"
        />
      </li>
    );
  }

  return (
    <li className="card c-lesson">
      <h3>
        <SafeText text={entry.title} />
      </h3>
      <div className="c-lesson-body">
        <SafeText text={entry.body} />
      </div>
      <div className="c-lesson-foot">
        <span className="small muted row" style={{ gap: 6 }}>
          {entry.author_kind !== 'person' && <Pill tone={entry.author_kind === 'conductor' ? 'purple' : 'accent'}>{entry.author_kind === 'conductor' ? 'Conductor' : 'Agent'}</Pill>}
          <span>
            Added by <SafeText text={by} />, <Time iso={entry.created_at} />
            {edited && (
              <>
                {' '}
                (edited <Time iso={entry.updated_at} />)
              </>
            )}
          </span>
        </span>
        <span className="c-lesson-actions">
          <button type="button" className="btn btn-sm c-touch" onClick={() => setEditing(true)} aria-label={`Edit the lesson "${entry.title}"`}>
            Edit
          </button>
          <button type="button" className="btn btn-sm btn-danger c-touch" onClick={() => setRemoving(true)} aria-label={`Remove the lesson "${entry.title}"`}>
            Remove
          </button>
        </span>
      </div>

      {removing && (
        <Dialog title="Remove this lesson?" onClose={() => !busy && setRemoving(false)}>
          <p>
            <strong>
              <SafeText text={entry.title} />
            </strong>
          </p>
          <p className="muted">It will disappear from the playbook for everyone in this room.</p>
          <div className="row">
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={async () => {
                const ok = await run(async () => {
                  await api.del(`/playbook/${entry.id}`);
                  await onChanged();
                  return true;
                }, 'Lesson removed');
                if (ok) setRemoving(false);
              }}
            >
              {busy ? 'Removing…' : 'Remove lesson'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setRemoving(false)}>
              Keep it
            </button>
          </div>
        </Dialog>
      )}
    </li>
  );
}

function LessonForm({
  initial,
  submitLabel,
  successText,
  onSave,
  onCancel,
}: {
  initial?: { title: string; body: string };
  submitLabel: string;
  successText: string;
  onSave: (title: string, body: string) => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const { busy, run } = useAction();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const ready = title.trim().length > 0 && body.trim().length > 0;

  const submit = () => {
    if (!ready || busy) return;
    void run(() => onSave(title.trim(), body.trim()), successText);
  };

  return (
    <form
      className="c-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="field">
        <label htmlFor={`${id}-title`}>Title</label>
        <input id={`${id}-title`} className="input" value={title} maxLength={MAX_TITLE} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder="A short rule of thumb" />
      </div>
      <div className="field">
        <label htmlFor={`${id}-body`}>What we learned</label>
        <textarea
          id={`${id}-body`}
          className="textarea"
          rows={4}
          value={body}
          maxLength={MAX_BODY}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Say what to do, and why it helps."
        />
        {body.length > MAX_BODY - 300 && (
          <span className={`tiny c-counter${body.length > MAX_BODY - 100 ? ' c-counter-warn' : ''}`}>
            {body.length} of {MAX_BODY} characters
          </span>
        )}
      </div>
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={busy || !ready}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

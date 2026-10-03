import { useEffect, useId, useState, type ReactNode } from 'react';
import type { AgentView, PersonListEntry, RoomDetail } from '../../../shared/app-types';
import { api } from '../../lib/api';
import { linkProps, navigate } from '../../lib/router';
import { useMe } from '../../lib/me';
import { Dialog, ErrorBanner, Light, Pill, useAction } from '../../components/ui';
import { SafeText } from '../../components/SafeText';
import './room-c.css';

type Changed = () => void | Promise<void>;

/** Asks before something is taken away. Runs `onConfirm` with the busy flag handled. */
function ConfirmRemove({ title, children, confirmLabel, onConfirm, onClose }: { title: string; children: ReactNode; confirmLabel: string; onConfirm: () => Promise<void>; onClose: () => void }) {
  const { busy, run } = useAction();
  return (
    <Dialog title={title} onClose={() => !busy && onClose()}>
      <div className="stack">
        {children}
        <div className="row">
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              const ok = await run(async () => {
                await onConfirm();
                return true;
              });
              if (ok) onClose();
            }}
          >
            {busy ? 'Removing…' : confirmLabel}
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** Loads a list when the screen opens and again whenever `key` changes (people or agents joined or left). */
function useList<T>(url: string, key: string) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    api
      .get<T[]>(url)
      .then((r) => {
        if (live) {
          setItems(r);
          setError(null);
        }
      })
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [url, key]);
  return { items, error };
}

// ------------------------------------------------------------------------------------ people

export function PeopleCard({ detail, onChanged }: { detail: RoomDetail; onChanged: Changed }) {
  const { me, refresh } = useMe();
  const { busy, run } = useAction();
  const roomId = detail.room.id;
  const { items: everyone, error } = useList<PersonListEntry>('/people', detail.people.map((p) => p.id).join(','));
  const [pick, setPick] = useState('');
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const selectId = useId();

  const inRoom = new Set(detail.people.map((p) => p.id));
  const candidates = (everyone ?? []).filter((p) => !p.disabled && !inRoom.has(p.id));
  const onlyOne = detail.people.length <= 1;

  return (
    <section className="card" aria-labelledby="c-set-people">
      <div className="c-card-title">
        <h3 id="c-set-people">People in this room</h3>
      </div>
      <p className="small muted" style={{ margin: '0 0 8px' }}>
        Everyone here sees this room, gets its alerts and can answer its questions. Only people in a room can see it.
      </p>
      <ul className="c-members">
        {detail.people.map((p) => (
          <li key={p.id} className="c-member">
            <span className="c-member-main">
              <strong className="truncate">
                <SafeText text={p.name} />
                {p.id === me.person.id && <span className="muted"> (you)</span>}
              </strong>
            </span>
            <button
              type="button"
              className="btn btn-sm btn-danger c-touch"
              disabled={onlyOne}
              title={onlyOne ? 'A room needs at least one person' : undefined}
              onClick={() => setRemoving({ id: p.id, name: p.name })}
              aria-label={`Remove ${p.name} from this room`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {onlyOne && <p className="tiny faint" style={{ margin: '4px 0 0' }}>A room needs at least one person, so the last one cannot be removed.</p>}

      <ErrorBanner error={error} />
      {everyone && candidates.length === 0 ? (
        <p className="small muted" style={{ margin: '12px 0 0' }}>
          Everyone with a Tempo account is already in this room. New people can be invited from <a {...linkProps('/settings')}>Settings</a>.
        </p>
      ) : (
        everyone && (
          <form
            className="c-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (!pick) return;
              void run(async () => {
                await api.post(`/rooms/${roomId}/people`, { person_id: pick });
                setPick('');
                await onChanged();
              }, 'Person added');
            }}
          >
            <div className="field">
              <label htmlFor={selectId}>Add a person</label>
              <select id={selectId} className="select" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose someone…</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.email})
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy || !pick}>
              {busy ? 'Adding…' : 'Add'}
            </button>
          </form>
        )
      )}

      {removing && (
        <ConfirmRemove
          title={removing.id === me.person.id ? 'Leave this room?' : `Remove ${removing.name}?`}
          confirmLabel={removing.id === me.person.id ? 'Leave the room' : 'Remove from room'}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const leaving = removing.id === me.person.id;
            await api.del(`/rooms/${roomId}/people/${removing.id}`);
            if (leaving) {
              await refresh();
              navigate('/');
            } else await onChanged();
          }}
        >
          <p style={{ margin: 0 }}>
            {removing.id === me.person.id
              ? 'You will no longer see this room or get its alerts, and your agents leave it with you. Someone in the room will need to add you back.'
              : `${removing.name} will no longer see this room or get its alerts, and their agents leave the room with them. You can add them back at any time.`}
          </p>
        </ConfirmRemove>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------ agents

const TYPE_WORDS: Record<AgentView['type'], string> = { muse: 'Muse', instinct: 'Instinct', other: 'Agent', stand_in: 'Practice agent' };

export function AgentsCard({ detail, onChanged }: { detail: RoomDetail; onChanged: Changed }) {
  const { busy, run } = useAction();
  const roomId = detail.room.id;
  const { items: visible, error } = useList<AgentView>('/agents', detail.agents.map((a) => a.id).join(','));
  const [pick, setPick] = useState('');
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const selectId = useId();

  const mine = (visible ?? []).filter((a) => a.is_mine && !a.room_ids.includes(roomId));

  return (
    <section className="card" aria-labelledby="c-set-agents">
      <div className="c-card-title">
        <h3 id="c-set-agents">Agents in this room</h3>
      </div>
      <p className="small muted" style={{ margin: '0 0 8px' }}>
        Agents check in here, answer questions and take instructions. You can only add agents you own; their owners add the rest.
      </p>
      {detail.agents.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          No agents yet.
        </p>
      ) : (
        <ul className="c-members">
          {detail.agents.map((a) => (
            <li key={a.id} className="c-member">
              <Light light={a.paused ? 'gray' : a.status} />
              <span className="c-member-main">
                <a {...linkProps(`/agents/${a.id}`)} className="truncate">
                  <strong>
                    <SafeText text={a.name} />
                  </strong>
                </a>
                <span className="tiny muted truncate">
                  {TYPE_WORDS[a.type]}, owned by <SafeText text={a.owner_name} />
                </span>
              </span>
              {a.paused && <Pill tone="amber">paused</Pill>}
              <button type="button" className="btn btn-sm btn-danger c-touch" onClick={() => setRemoving({ id: a.id, name: a.name })} aria-label={`Remove ${a.name} from this room`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <ErrorBanner error={error} />
      {visible && mine.length === 0 ? (
        <p className="small muted" style={{ margin: '12px 0 0' }}>
          You have no other agents to add. You can set one up on the <a {...linkProps('/agents')}>Agents page</a>.
        </p>
      ) : (
        visible && (
          <form
            className="c-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (!pick) return;
              void run(async () => {
                await api.post(`/rooms/${roomId}/agents`, { agent_id: pick });
                setPick('');
                await onChanged();
              }, 'Agent added');
            }}
          >
            <div className="field">
              <label htmlFor={selectId}>Add one of your agents</label>
              <select id={selectId} className="select" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose an agent…</option>
                {mine.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({TYPE_WORDS[a.type]})
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy || !pick}>
              {busy ? 'Adding…' : 'Add'}
            </button>
          </form>
        )
      )}

      {removing && (
        <ConfirmRemove
          title={`Remove ${removing.name}?`}
          confirmLabel="Remove from room"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api.del(`/rooms/${roomId}/agents/${removing.id}`);
            await onChanged();
          }}
        >
          <p style={{ margin: 0 }}>
            {removing.name} will stop getting instructions from this room and drop off the board. Its earlier updates stay in the feed, and it can be added back later.
          </p>
        </ConfirmRemove>
      )}
    </section>
  );
}

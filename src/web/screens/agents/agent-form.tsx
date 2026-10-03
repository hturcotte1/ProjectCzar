import { useEffect, useState } from 'react';
import type { RoomSummary, SecretsView } from '../../../shared/app-types';
import { api } from '../../lib/api';
import { FormError } from './form-error';
import { TYPE_CHOICES } from './agent-common';
import { DEFAULT_DRAFT, ScheduleFields, checkDraft, type ScheduleDraft, type ScheduleErrors } from './schedule-fields';

/** "Add an agent": name, kind, rooms and check-in schedule. Creating it returns the one-time secrets. */
export function AddAgentForm({ rooms, onCreated, onCancel }: { rooms: RoomSummary[]; onCreated: (s: SecretsView) => void; onCancel: () => void }) {
  const choices = rooms.filter((r) => !r.is_sandbox);
  const [name, setName] = useState('');
  const [type, setType] = useState<(typeof TYPE_CHOICES)[number]['value']>('muse');
  const [description, setDescription] = useState('');
  const [roomIds, setRoomIds] = useState<string[]>(choices.length === 1 ? [choices[0].id] : []);
  const [draft, setDraftRaw] = useState<ScheduleDraft>(DEFAULT_DRAFT);
  const [scheduleTouched, setScheduleTouched] = useState(false);
  const setDraft = (d: ScheduleDraft) => {
    setScheduleTouched(true);
    setDraftRaw(d);
  };
  // Until the person edits the schedule, it follows the first chosen room's clock and hours.
  useEffect(() => {
    if (scheduleTouched) return;
    const room = choices.find((r) => roomIds.includes(r.id));
    if (!room) return;
    setDraftRaw((d) => ({ ...d, timezone: room.timezone, days: [...room.work_days].sort((a, b) => a - b), start: room.work_start, end: room.work_end }));
  }, [roomIds, scheduleTouched]); // eslint-disable-line react-hooks/exhaustive-deps
  const [errors, setErrors] = useState<ScheduleErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const checked = checkDraft(draft, { offsetRequired: false, withGrace: false });
    setErrors(checked.errors);
    if (!checked.input) {
      setError(new Error('Please fix the schedule below.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<SecretsView>('/agents', {
        name: name.trim(),
        type,
        description: description.trim() || undefined,
        room_ids: roomIds,
        schedule: checked.input,
      });
      onCreated(created);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card ag-form" onSubmit={submit} aria-labelledby="ag-add-title">
      <div className="stack">
        <h2 id="ag-add-title">Add an agent</h2>
        <FormError error={error} />

        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="ag-name">Name</label>
          <input id="ag-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder="Muse Henry" autoComplete="off" />
          <span className="hint">Other agents use this name to talk to it, so it has to be different from every other agent in Tempo.</span>
        </div>

        <fieldset className="ag-fieldset">
          <legend className="label">What kind of agent is it?</legend>
          <div className="ag-types">
            {TYPE_CHOICES.map((c) => (
              <label key={c.value} className={`ag-type${type === c.value ? ' on' : ''}`}>
                <input type="radio" name="agent-type" value={c.value} checked={type === c.value} onChange={() => setType(c.value)} />
                <span className="ag-type-name">{c.label}</span>
                <span className="muted small">{c.blurb}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="ag-desc">What does it do? (optional)</label>
          <input id="ag-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="Writes copy for the launch" />
        </div>

        <fieldset className="ag-fieldset">
          <legend className="label">Rooms</legend>
          {choices.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              You are not in a room yet. You can still add the agent now and put it in a room later.
            </p>
          ) : (
            <div className="ag-rooms">
              {choices.map((r) => (
                <label key={r.id} className="check">
                  <input type="checkbox" checked={roomIds.includes(r.id)} onChange={() => setRoomIds((ids) => (ids.includes(r.id) ? ids.filter((x) => x !== r.id) : [...ids, r.id]))} />
                  {r.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset className="ag-fieldset">
          <legend className="label">When should it check in?</legend>
          <ScheduleFields
            value={draft}
            onChange={setDraft}
            errors={errors}
            idPrefix="ag-new"
            offsetHint="Leave this blank and Tempo picks one for you: when a room has more than one agent, check-ins are spread half an interval apart."
          />
        </fieldset>

        <div className="row">
          <button className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? 'Adding…' : 'Add agent'}
          </button>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

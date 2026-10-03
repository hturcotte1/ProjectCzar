import { useMemo, useState } from 'react';
import type { RoomView } from '../../../shared/app-types';
import { api } from '../../lib/api';
import { DAY_NAMES } from '../../lib/format';
import { useAction } from '../../components/ui';
import { Field, isTimeZone, sameList, timeZoneOptions, toLines } from './settings-common';
import './room-c.css';

/** What the form edits, as plain strings and numbers (lists are one entry per line). */
interface Values {
  name: string;
  goal: string;
  rules: string;
  allowed: string;
  askFirst: string;
  timezone: string;
  days: number[];
  start: string;
  end: string;
  brief: string;
  cardBudget: string;
  maxOpen: string;
}

const fromRoom = (r: RoomView): Values => ({
  name: r.name,
  goal: r.goal,
  rules: r.rules.join('\n'),
  allowed: r.limits_allowed.join('\n'),
  askFirst: r.limits_ask_first.join('\n'),
  timezone: r.timezone,
  days: [...r.work_days].sort((a, b) => a - b),
  start: r.work_start,
  end: r.work_end,
  brief: r.brief_time,
  cardBudget: r.card_token_budget === null ? '' : String(r.card_token_budget),
  maxOpen: r.max_open_instructions === null ? '' : String(r.max_open_instructions),
});

type Patch = Partial<{
  name: string;
  goal: string;
  rules: string[];
  limits_allowed: string[];
  limits_ask_first: string[];
  timezone: string;
  work_days: number[];
  work_start: string;
  work_end: string;
  brief_time: string;
  card_token_budget: number | null;
  max_open_instructions: number | null;
}>;

/** Works out which fields changed (only those are sent) and what is wrong with the rest. */
function check(v: Values, room: RoomView): { patch: Patch; errors: Partial<Record<keyof Values, string>> } {
  const patch: Patch = {};
  const errors: Partial<Record<keyof Values, string>> = {};

  const name = v.name.trim();
  if (!name || name.length > 80) errors.name = 'Give the room a name of up to 80 characters.';
  else if (name !== room.name) patch.name = name;

  if (v.goal.trim() !== room.goal.trim()) patch.goal = v.goal.trim();

  const rules = toLines(v.rules);
  if (!sameList(rules, room.rules)) patch.rules = rules;
  const allowed = toLines(v.allowed);
  if (!sameList(allowed, room.limits_allowed)) patch.limits_allowed = allowed;
  const askFirst = toLines(v.askFirst);
  if (!sameList(askFirst, room.limits_ask_first)) patch.limits_ask_first = askFirst;

  const zone = v.timezone.trim();
  if (!zone || !isTimeZone(zone)) errors.timezone = 'That is not a time zone. Pick one from the list, like America/Boise.';
  else if (zone !== room.timezone) patch.timezone = zone;

  if (v.days.length === 0) errors.days = 'Pick at least one working day.';
  else if (!sameList(v.days, [...room.work_days].sort((a, b) => a - b))) patch.work_days = v.days;

  if (!v.start) errors.start = 'Pick a start time.';
  if (!v.end) errors.end = 'Pick an end time.';
  if (v.start && v.end && v.end <= v.start) errors.end = 'Working hours must end after they start.';
  if (!errors.start && v.start !== room.work_start) patch.work_start = v.start;
  if (!errors.end && v.end !== room.work_end) patch.work_end = v.end;

  if (!v.brief) errors.brief = 'Pick a time for the daily brief.';
  else if (v.brief !== room.brief_time) patch.brief_time = v.brief;

  const card = v.cardBudget.trim();
  if (card === '') {
    if (room.card_token_budget !== null) patch.card_token_budget = null;
  } else if (!/^\d+$/.test(card) || Number(card) < 300 || Number(card) > 20000) {
    errors.cardBudget = 'Use a whole number from 300 to 20,000, or leave it empty for the standard size.';
  } else if (Number(card) !== room.card_token_budget) patch.card_token_budget = Number(card);

  const open = v.maxOpen.trim();
  if (open === '') {
    if (room.max_open_instructions !== null) patch.max_open_instructions = null;
  } else if (!/^\d+$/.test(open) || Number(open) < 1 || Number(open) > 20) {
    errors.maxOpen = 'Use a whole number from 1 to 20, or leave it empty for the standard limit.';
  } else if (Number(open) !== room.max_open_instructions) patch.max_open_instructions = Number(open);

  return { patch, errors };
}

/**
 * The room's own settings in one form. Edits are kept as a draft on top of the saved room, so a
 * live refresh never wipes what someone is typing; Save sends only what changed.
 */
export function RoomForm({ room, onChanged }: { room: RoomView; onChanged: () => void | Promise<void> }) {
  const { busy, run } = useAction();
  const [draft, setDraft] = useState<Partial<Values>>({});
  const zones = useMemo(timeZoneOptions, []);
  const values: Values = { ...fromRoom(room), ...draft };
  const { patch, errors } = check(values, room);
  const dirty = Object.keys(patch).length > 0;
  const blocked = Object.keys(errors).length > 0;
  // Setting a field back to what is saved drops it from the draft, so only real edits count.
  const set = <K extends keyof Values>(key: K, v: Values[K]) =>
    setDraft((d) => {
      const next = { ...d };
      if (JSON.stringify(fromRoom(room)[key]) === JSON.stringify(v)) delete next[key];
      else next[key] = v;
      return next;
    });

  const save = () =>
    run(async () => {
      await api.patch(`/rooms/${room.id}`, patch);
      await onChanged();
      setDraft({});
    }, 'Settings saved');

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !blocked && !busy) void save();
      }}
    >
      <section className="card" aria-labelledby="c-set-basics">
        <div className="c-card-title">
          <h3 id="c-set-basics">The basics</h3>
        </div>
        <Field label="Room name" hint="What people see in the sidebar." error={errors.name}>
          {(p) => <input {...p} className="input" value={values.name} maxLength={80} onChange={(e) => set('name', e.target.value)} />}
        </Field>
        <Field label="Goal" hint="What this room is working toward. The Conductor turns it into instructions, and takes a fresh look whenever it changes.">
          {(p) => <textarea {...p} className="textarea" rows={4} value={values.goal} maxLength={4000} onChange={(e) => set('goal', e.target.value)} />}
        </Field>
      </section>

      <section className="card" aria-labelledby="c-set-rules">
        <div className="c-card-title">
          <h3 id="c-set-rules">Rules and limits</h3>
        </div>
        <Field label="Rules" hint="House rules every agent should follow. Write one per line.">
          {(p) => <textarea {...p} className="textarea" rows={4} value={values.rules} onChange={(e) => set('rules', e.target.value)} placeholder="Always link to your proof&#10;Keep updates short" />}
        </Field>
        <Field label="Agents may do without asking" hint="Things the Conductor and agents can just do. One per line.">
          {(p) => <textarea {...p} className="textarea" rows={4} value={values.allowed} onChange={(e) => set('allowed', e.target.value)} />}
        </Field>
        <Field label="Ask a person first before" hint="Anything on this list becomes a decision for you to approve. One per line.">
          {(p) => <textarea {...p} className="textarea" rows={4} value={values.askFirst} onChange={(e) => set('askFirst', e.target.value)} />}
        </Field>
      </section>

      <section className="card" aria-labelledby="c-set-time">
        <div className="c-card-title">
          <h3 id="c-set-time">When the room works</h3>
        </div>
        <Field label="Time zone" hint="Working hours and the daily brief follow this clock. Start typing a city, like America/Boise." error={errors.timezone}>
          {(p) => (
            <>
              <input {...p} className="input" list="c-zones" value={values.timezone} autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => set('timezone', e.target.value)} />
              <datalist id="c-zones">
                {zones.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </>
          )}
        </Field>

        <div className="field">
          <fieldset className="c-days" aria-describedby="c-days-hint">
            <legend>Working days</legend>
            {DAY_NAMES.map((name, i) => {
              const day = i + 1;
              const on = values.days.includes(day);
              return (
                <label key={day} className="c-day" data-checked={on}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => set('days', (on ? values.days.filter((d) => d !== day) : [...values.days, day]).sort((a, b) => a - b))}
                  />
                  {name}
                </label>
              );
            })}
          </fieldset>
          <span className="hint" id="c-days-hint">
            Agents are only expected to check in on these days, and the daily brief is only written on them.
          </span>
          {errors.days && (
            <span className="c-field-error" role="alert">
              {errors.days}
            </span>
          )}
        </div>

        <div className="c-times">
          <Field label="Working hours start" error={errors.start}>
            {(p) => <input {...p} className="input" type="time" value={values.start} onChange={(e) => set('start', e.target.value)} />}
          </Field>
          <Field label="Working hours end" error={errors.end}>
            {(p) => <input {...p} className="input" type="time" value={values.end} onChange={(e) => set('end', e.target.value)} />}
          </Field>
          <Field label="Daily brief time" error={errors.brief}>
            {(p) => <input {...p} className="input" type="time" value={values.brief} onChange={(e) => set('brief', e.target.value)} />}
          </Field>
        </div>
        <p className="hint small muted" style={{ margin: '8px 0 0' }}>
          Check-ins are expected between the start and end times. The brief arrives at the brief time.
        </p>
      </section>

      <section className="card" aria-labelledby="c-set-size">
        <div className="c-card-title">
          <h3 id="c-set-size">Size limits</h3>
        </div>
        <Field
          label="Check-in card size limit (optional)"
          hint="The most text an agent's check-in card may hold, counted in tokens (a token is about four letters). Leave empty for the standard size."
          error={errors.cardBudget}
        >
          {(p) => <input {...p} className="input" inputMode="numeric" value={values.cardBudget} placeholder="Standard size" onChange={(e) => set('cardBudget', e.target.value)} />}
        </Field>
        <Field
          label="Most open instructions per agent (optional)"
          hint="Stops an agent from being buried: new instructions wait once it has this many open. Leave empty for the standard limit."
          error={errors.maxOpen}
        >
          {(p) => <input {...p} className="input" inputMode="numeric" value={values.maxOpen} placeholder="Standard limit" onChange={(e) => set('maxOpen', e.target.value)} />}
        </Field>
      </section>

      {(dirty || blocked) && (
        <div className="c-savebar" role="region" aria-label="Save changes">
          <span className="small" aria-live="polite">
            {blocked ? 'Fix the highlighted fields to save.' : dirty ? 'You have changes that are not saved yet.' : 'No changes.'}
          </span>
          <span className="row">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDraft({})}>
              Discard
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !dirty || blocked}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </span>
        </div>
      )}
    </form>
  );
}

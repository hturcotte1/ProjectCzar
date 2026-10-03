import { useMemo } from 'react';
import type { ScheduleView } from '../../../shared/app-types';
import { DAY_NAMES } from '../../lib/format';

/** The check-in schedule form, shared by "Add an agent" and the schedule editor on an agent's page. */

export interface ScheduleDraft {
  interval: string;
  days: number[]; // 1 = Monday ... 7 = Sunday
  start: string;
  end: string;
  timezone: string;
  offset: string;
  grace: string;
}

export interface ScheduleInput {
  interval_minutes: number;
  work_days: number[];
  work_start: string;
  work_end: string;
  timezone: string;
  offset_minutes?: number;
  grace_minutes?: number;
}

export type ScheduleErrors = Partial<Record<keyof ScheduleDraft, string>>;

export const DEFAULT_DRAFT: ScheduleDraft = { interval: '60', days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00', timezone: 'America/Boise', offset: '', grace: '15' };

export function draftFrom(s: ScheduleView): ScheduleDraft {
  return {
    interval: String(s.interval_minutes),
    days: [...s.work_days].sort((a, b) => a - b),
    start: s.work_start,
    end: s.work_end,
    timezone: s.timezone,
    offset: String(s.offset_minutes),
    grace: String(s.grace_minutes),
  };
}

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function wholeNumber(text: string): number | null {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
}

/** Turns what was typed into what the server accepts, or says in plain words what is wrong. */
export function checkDraft(d: ScheduleDraft, opts: { offsetRequired: boolean; withGrace: boolean }): { input: ScheduleInput | null; errors: ScheduleErrors } {
  const errors: ScheduleErrors = {};
  const interval = wholeNumber(d.interval);
  if (interval === null || interval < 5 || interval > 1440) errors.interval = 'Use a whole number of minutes from 5 to 1440 (24 hours).';
  if (d.days.length === 0) errors.days = 'Pick at least one working day.';
  if (!/^\d{2}:\d{2}$/.test(d.start)) errors.start = 'Pick a start time.';
  if (!/^\d{2}:\d{2}$/.test(d.end)) errors.end = 'Pick an end time.';
  if (!errors.start && !errors.end && d.start >= d.end) errors.end = 'The end time must be after the start time.';
  if (!d.timezone.trim() || !isTimeZone(d.timezone.trim())) errors.timezone = 'That is not a time zone. Pick one from the list, like America/Boise.';
  let offset: number | null = null;
  if (d.offset.trim() === '') {
    if (opts.offsetRequired) errors.offset = 'Enter a number of minutes (0 is fine).';
  } else {
    offset = wholeNumber(d.offset);
    if (offset === null) errors.offset = 'Use a whole number of minutes, or leave it blank.';
  }
  let grace: number | null = null;
  if (opts.withGrace) {
    grace = wholeNumber(d.grace);
    if (grace === null || grace < 1 || grace > 240) errors.grace = 'Use a whole number of minutes from 1 to 240.';
  }
  if (Object.keys(errors).length) return { input: null, errors };
  const input: ScheduleInput = {
    interval_minutes: interval!,
    work_days: [...d.days].sort((a, b) => a - b),
    work_start: d.start,
    work_end: d.end,
    timezone: d.timezone.trim(),
  };
  if (offset !== null) input.offset_minutes = offset;
  if (grace !== null) input.grace_minutes = grace;
  return { input, errors };
}

function intervalWords(text: string): string {
  const n = wholeNumber(text);
  if (n === null || n < 5) return '';
  if (n % 60 === 0) return n === 60 ? 'Every hour' : `Every ${n / 60} hours`;
  return `Every ${n} minutes`;
}

const FALLBACK_ZONES = ['America/Boise', 'America/Denver', 'America/Los_Angeles', 'America/Chicago', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];

function allZones(): string[] {
  try {
    const list = Intl.supportedValuesOf('timeZone');
    return list.length ? list : FALLBACK_ZONES;
  } catch {
    return FALLBACK_ZONES;
  }
}

export function ScheduleFields({
  value,
  onChange,
  errors,
  idPrefix,
  withGrace,
  offsetHint,
}: {
  value: ScheduleDraft;
  onChange: (next: ScheduleDraft) => void;
  errors: ScheduleErrors;
  idPrefix: string;
  withGrace?: boolean;
  offsetHint: string;
}) {
  const zones = useMemo(allZones, []);
  const set = <K extends keyof ScheduleDraft>(key: K, v: ScheduleDraft[K]) => onChange({ ...value, [key]: v });
  const id = (name: string) => `${idPrefix}-${name}`;
  const err = (key: keyof ScheduleDraft) => (errors[key] ? <span className="ag-error" id={id(`${key}-err`)}>{errors[key]}</span> : null);
  const aria = (key: keyof ScheduleDraft) => (errors[key] ? { 'aria-invalid': true, 'aria-describedby': id(`${key}-err`) } : {});

  return (
    <div className="ag-sched">
      <div className="field ag-f-interval">
        <label htmlFor={id('interval')}>Check in every (minutes)</label>
        <input id={id('interval')} className="input" inputMode="numeric" value={value.interval} onChange={(e) => set('interval', e.target.value)} {...aria('interval')} />
        {errors.interval ? err('interval') : <span className="hint">{intervalWords(value.interval) || 'For example 60 for every hour.'}</span>}
      </div>

      <fieldset className="ag-days field ag-f-days">
        <legend className="label">Working days</legend>
        <div className="ag-day-row">
          {DAY_NAMES.map((name, i) => {
            const day = i + 1;
            const on = value.days.includes(day);
            return (
              <label key={name} className={`ag-day${on ? ' on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => set('days', on ? value.days.filter((d) => d !== day) : [...value.days, day].sort((a, b) => a - b))} />
                {name}
              </label>
            );
          })}
        </div>
        {err('days')}
      </fieldset>

      <div className="ag-pair ag-pair-time ag-f-time">
        <div className="field">
          <label htmlFor={id('start')}>From</label>
          <input id={id('start')} type="time" className="input" value={value.start} onChange={(e) => set('start', e.target.value)} {...aria('start')} />
          {err('start')}
        </div>
        <div className="field">
          <label htmlFor={id('end')}>Until</label>
          <input id={id('end')} type="time" className="input" value={value.end} onChange={(e) => set('end', e.target.value)} {...aria('end')} />
          {err('end')}
        </div>
      </div>

      <div className="field ag-f-zone">
        <label htmlFor={id('tz')}>Time zone</label>
        <input id={id('tz')} className="input" list={id('zones')} value={value.timezone} onChange={(e) => set('timezone', e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} {...aria('timezone')} />
        <datalist id={id('zones')}>
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
        {errors.timezone ? err('timezone') : <span className="hint">Working hours follow this clock. Start typing a city, like America/Boise.</span>}
      </div>

      <div className={`ag-f-offset${withGrace ? ' ag-pair' : ''}`}>
        <div className="field">
          <label htmlFor={id('offset')}>Minute offset</label>
          <input id={id('offset')} className="input" inputMode="numeric" placeholder="Suggested" value={value.offset} onChange={(e) => set('offset', e.target.value)} {...aria('offset')} />
          {errors.offset ? err('offset') : <span className="hint">{offsetHint}</span>}
        </div>
        {withGrace && (
          <div className="field">
            <label htmlFor={id('grace')}>Late after (minutes)</label>
            <input id={id('grace')} className="input" inputMode="numeric" value={value.grace} onChange={(e) => set('grace', e.target.value)} {...aria('grace')} />
            {errors.grace ? err('grace') : <span className="hint">How long Tempo waits past a check-in time before the light turns amber.</span>}
          </div>
        )}
      </div>
    </div>
  );
}

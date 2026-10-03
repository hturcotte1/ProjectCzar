import type { DB } from '../db/index.js';
import { parseJson } from '../db/index.js';
import { iso } from '../lib/time.js';

/**
 * Debounced Conductor triggers. A trigger stores "run at" in the database; the scheduler starts
 * the run when that time passes. Two check-ins close together make one run: each new trigger
 * pushes the run time out to now + delay, but never more than MAX_WAIT after the first trigger.
 */
export type TriggerKind =
  | 'checkin'
  | 'person_instruction'
  | 'person_message'
  | 'goal_changed'
  | 'decision_resolved'
  | 'sweep'
  | 'manual'
  | 'mode_changed'
  | 'question_for_conductor';

export interface Trigger {
  kind: TriggerKind;
  detail: string;
  at: string;
}

export const CHECKIN_DELAY_MS = 45_000;
export const PERSON_DELAY_MS = 10_000;
const MAX_WAIT_MS = 3 * 60_000;

export function requestConductorRun(
  db: DB,
  roomId: string,
  trigger: { kind: TriggerKind; detail: string },
  nowMs: number,
  delayMs: number,
  clockSpeed = 1,
): void {
  const speed = clockSpeed > 0 ? clockSpeed : 1;
  const delay = Math.max(1000, Math.round(delayMs / speed));
  const state = db.prepare('SELECT * FROM conductor_state WHERE room_id = ?').get(roomId) as
    | { pending_run_at: string | null; pending_triggers: string }
    | undefined;
  const triggers = state ? parseJson<Trigger[]>(state.pending_triggers, []) : [];
  const first = state?.pending_run_at && triggers.length ? new Date(triggers[0].at).getTime() : nowMs;
  const runAt = Math.min(nowMs + delay, first + Math.max(delay, MAX_WAIT_MS / speed));
  const next: Trigger[] = [...triggers, { ...trigger, at: iso(nowMs) }].slice(-20);
  db.prepare(
    `INSERT INTO conductor_state (room_id, pending_run_at, pending_triggers) VALUES (?, ?, ?)
     ON CONFLICT(room_id) DO UPDATE SET pending_run_at = excluded.pending_run_at, pending_triggers = excluded.pending_triggers`,
  ).run(roomId, iso(runAt), JSON.stringify(next));
}

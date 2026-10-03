import type { DB } from '../db/index.js';
import { parseJson } from '../db/index.js';
import type { BusEvent } from '../lib/bus.js';
import type { FeedRow } from './rows.js';

/**
 * The timeline. Every visible thing that happens in a room is one feed event.
 *
 * Kinds:
 *   report              an agent's check-in report for this room (updated in place on re-send)
 *   post                an agent's message or note between check-ins
 *   message             a person's message (to the room, to one agent, or to the Conductor)
 *   question            a question (thread = q_ id)
 *   answer              an answer (thread = q_ id)
 *   instruction         an instruction going live on a card (thread = ins_ id)
 *   proposal            a Conductor instruction waiting for approval in propose mode (thread = ins_ id)
 *   instruction_status  a status change (thread = ins_ id)
 *   decision            a decision waiting on a person (thread = dec_ id)
 *   decision_resolved   a person's resolution (thread = dec_ id)
 *   conductor_note      a short public note from the Conductor
 *   playbook            a new lesson saved to the playbook
 *   brief               the daily brief
 *   system              missed check-ins, recoveries, pauses, goal and mode changes, members joining
 */
export const FEED_KINDS = [
  'report',
  'post',
  'message',
  'question',
  'answer',
  'instruction',
  'proposal',
  'instruction_status',
  'decision',
  'decision_resolved',
  'conductor_note',
  'playbook',
  'brief',
  'system',
] as const;
export type FeedKind = (typeof FEED_KINDS)[number];

export interface NewFeedEvent {
  roomId: string;
  kind: FeedKind;
  actorKind: FeedRow['actor_kind'];
  actorId?: string | null;
  actorName: string;
  targetAgentId?: string | null;
  threadId?: string | null;
  refId?: string | null;
  text: string;
  data?: Record<string, unknown>;
  at: string;
}

export function feedEventId(seq: number): string {
  return `evt_${seq}`;
}

export function appendFeed(db: DB, e: NewFeedEvent, emit?: (ev: BusEvent) => void): number {
  const info = db
    .prepare(
      `INSERT INTO feed_events (room_id, kind, actor_kind, actor_id, actor_name, target_agent_id, thread_id, ref_id, text, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      e.roomId,
      e.kind,
      e.actorKind,
      e.actorId ?? null,
      e.actorName,
      e.targetAgentId ?? null,
      e.threadId ?? null,
      e.refId ?? null,
      e.text,
      JSON.stringify(e.data ?? {}),
      e.at,
    );
  const seq = Number(info.lastInsertRowid);
  emit?.({ type: 'feed', roomId: e.roomId, seq });
  return seq;
}

export function updateFeed(
  db: DB,
  seq: number,
  patch: { text: string; data?: Record<string, unknown>; at: string },
  emit?: (ev: BusEvent) => void,
): void {
  const row = db.prepare('SELECT room_id, data FROM feed_events WHERE seq = ?').get(seq) as
    | { room_id: string; data: string }
    | undefined;
  if (!row) return;
  const data = patch.data ?? parseJson<Record<string, unknown>>(row.data, {});
  db.prepare('UPDATE feed_events SET text = ?, data = ?, updated_at = ? WHERE seq = ?').run(
    patch.text,
    JSON.stringify(data),
    patch.at,
    seq,
  );
  emit?.({ type: 'feed', roomId: row.room_id, seq, updated: true });
}

export function getFeedRow(db: DB, seq: number): FeedRow | undefined {
  return db.prepare('SELECT * FROM feed_events WHERE seq = ?').get(seq) as FeedRow | undefined;
}

export function maxFeedSeq(db: DB, roomId: string): number {
  const r = db.prepare('SELECT MAX(seq) AS m FROM feed_events WHERE room_id = ?').get(roomId) as { m: number | null };
  return r.m ?? 0;
}

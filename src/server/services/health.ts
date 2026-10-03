import type { AppContext } from '../context.js';
import { iso, ms } from '../lib/time.js';
import type { HealthView } from '../../shared/app-types.js';
import { roomAgents } from './repo.js';
import { firstSlotAfter, scaled, scheduleFromRow } from './schedule.js';

/**
 * Room health over the last 7 days: the share of scheduled check-ins that arrived on time, the
 * typical time for a question to get answered, and open blockers.
 *
 * A slot counts as on time when a completed check-in landed between half an interval before it
 * and the grace period after it (the same rule the status lights use).
 */
export function roomHealth(ctx: AppContext, roomId: string, windowDays = 7): HealthView {
  const now = ctx.clock.now();
  const from = now - windowDays * 86400_000;
  let expected = 0;
  let onTime = 0;
  const perAgent: HealthView['per_agent'] = [];

  for (const a of roomAgents(ctx.db, roomId)) {
    const s = scheduleFromRow(a);
    const start = Math.max(from, a.first_seen_at ? ms(a.first_seen_at) : now);
    const checkins = (
      ctx.db
        .prepare(`SELECT completed_at FROM cards WHERE agent_id = ? AND status = 'completed' AND completed_at >= ? ORDER BY completed_at`)
        .all(a.id, iso(start - scaled(s, s.intervalMinutes))) as { completed_at: string }[]
    ).map((c) => ms(c.completed_at));
    let exp = 0;
    let ok = 0;
    const half = scaled(s, s.intervalMinutes) / 2;
    const grace = scaled(s, s.graceMinutes);
    let slot = firstSlotAfter(s, start);
    let guard = 0;
    while (slot !== null && slot + grace <= now && guard < 5000) {
      exp++;
      if (checkins.some((c) => c >= slot! - half && c <= slot! + grace)) ok++;
      slot = firstSlotAfter(s, slot);
      guard++;
    }
    const incomplete = (
      ctx.db.prepare(`SELECT COUNT(*) AS n FROM cards WHERE agent_id = ? AND incomplete_at IS NOT NULL AND issued_at >= ?`).get(a.id, iso(from)) as { n: number }
    ).n;
    expected += exp;
    onTime += ok;
    perAgent.push({ agent_id: a.id, agent_name: a.name, expected: exp, on_time: ok, rate: exp ? ok / exp : null, incomplete_cards: incomplete });
  }

  const answered = ctx.db
    .prepare(`SELECT created_at, answered_at FROM questions WHERE room_id = ? AND status = 'answered' AND answered_at >= ?`)
    .all(roomId, iso(from)) as { created_at: string; answered_at: string }[];
  const minutes = answered.map((q) => (ms(q.answered_at) - ms(q.created_at)) / 60_000).sort((x, y) => x - y);
  const median = minutes.length
    ? minutes.length % 2
      ? minutes[(minutes.length - 1) / 2]
      : (minutes[minutes.length / 2 - 1] + minutes[minutes.length / 2]) / 2
    : null;

  const blockers: HealthView['open_blockers'] = [];
  for (const a of roomAgents(ctx.db, roomId)) {
    const latest = ctx.db
      .prepare(`SELECT blocked_reason, blocked_unblock, created_at FROM report_rooms WHERE room_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(roomId, a.id) as { blocked_reason: string | null; blocked_unblock: string | null; created_at: string } | undefined;
    if (latest?.blocked_reason) {
      blockers.push({ agent_id: a.id, agent_name: a.name, reason: latest.blocked_reason, what_would_unblock: latest.blocked_unblock ?? '', since: latest.created_at });
    }
  }
  const blockedIns = ctx.db
    .prepare(`SELECT i.*, a.name AS agent_name FROM instructions i JOIN agents a ON a.id = i.agent_id WHERE i.room_id = ? AND i.status = 'blocked'`)
    .all(roomId) as { agent_id: string; agent_name: string; id: string; status_note: string | null; last_movement_at: string }[];
  for (const b of blockedIns) {
    blockers.push({ agent_id: b.agent_id, agent_name: b.agent_name, reason: `${b.id} is blocked: ${b.status_note ?? ''}`, what_would_unblock: '', since: b.last_movement_at });
  }

  return {
    window_days: windowDays,
    checkins_expected: expected,
    checkins_on_time: onTime,
    on_time_rate: expected ? onTime / expected : null,
    median_answer_minutes: median === null ? null : Math.round(median),
    answered_questions: answered.length,
    open_blockers: blockers,
    per_agent: perAgent,
  };
}

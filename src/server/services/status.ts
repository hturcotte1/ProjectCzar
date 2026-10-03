import type { AppContext } from '../context.js';
import { nextId } from '../db/index.js';
import type { BusEvent } from '../lib/bus.js';
import { iso, ms, plainTime } from '../lib/time.js';
import { createAlert } from './alerts.js';
import { appendFeed } from './feed.js';
import { rearmMessage } from './join-messages.js';
import { agentRooms, getAgent } from './repo.js';
import type { AgentRow } from './rows.js';
import { computeStatus, scheduleFromRow, type StatusResult } from './schedule.js';

/**
 * Status lights are always computed from stored timestamps. `agents.status` remembers the last
 * evaluated light only so a change (and its alert) happens once, even across restarts.
 */

type Emit = (e: BusEvent) => void;

export function computeAgentStatus(ctx: AppContext, agent: AgentRow): StatusResult {
  const rooms = agentRooms(ctx.db, agent.id);
  const paused = !!agent.paused_at || (rooms.length > 0 && rooms.every((r) => !!r.paused_at));
  const open = ctx.db
    .prepare(
      `SELECT issued_at FROM cards WHERE agent_id = ? AND status IN ('open', 'expired') AND (? IS NULL OR issued_at > ?)
       ORDER BY issued_at DESC LIMIT 1`,
    )
    .get(agent.id, agent.last_checkin_at, agent.last_checkin_at) as { issued_at: string } | undefined;
  return computeStatus({
    schedule: scheduleFromRow(agent),
    now: ctx.clock.now(),
    paused,
    inAnyRoom: rooms.length > 0,
    firstSeenMs: agent.first_seen_at ? ms(agent.first_seen_at) : null,
    lastCheckinMs: agent.last_checkin_at ? ms(agent.last_checkin_at) : null,
    openCardIssuedMs: open ? ms(open.issued_at) : null,
    cardTimeoutMinutes: ctx.config.cardTimeoutMinutes,
  });
}

function systemEvent(ctx: AppContext, agent: AgentRow, text: (tz: string) => string, event: string, emit: Emit): void {
  const at = iso(ctx.clock.now());
  for (const room of agentRooms(ctx.db, agent.id)) {
    appendFeed(
      ctx.db,
      {
        roomId: room.id,
        kind: 'system',
        actorKind: 'system',
        actorName: 'Tempo',
        targetAgentId: agent.id,
        refId: agent.id,
        text: text(room.timezone),
        data: { event, agent_id: agent.id, show_on_cards: false },
        at,
      },
      emit,
    );
  }
}

/** Re-evaluates one agent's light and handles transitions (feed events, incidents, alerts). */
export function refreshAgentStatus(ctx: AppContext, agentId: string, emit: Emit): StatusResult | null {
  const agent = getAgent(ctx.db, agentId);
  if (!agent || agent.archived_at) return null;
  const s = computeAgentStatus(ctx, agent);
  const now = ctx.clock.now();
  const at = iso(now);
  const prev = agent.status;
  const roomIds = agentRooms(ctx.db, agent.id).map((r) => r.id);

  if (s.light !== prev || s.reason !== agent.status_reason) {
    ctx.db
      .prepare(
        `UPDATE agents SET status = ?, status_reason = ?, status_changed_at = CASE WHEN status != ? THEN ? ELSE status_changed_at END WHERE id = ?`,
      )
      .run(s.light, s.reason, s.light, at, agent.id);
    emit({ type: 'agent', agentId: agent.id, roomIds });
  }

  const openIncident = ctx.db
    .prepare(`SELECT * FROM incidents WHERE agent_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`)
    .get(agent.id) as { id: string; started_at: string; hint: string | null } | undefined;

  if (s.light !== prev) {
    if (s.light === 'amber' && prev !== 'red') {
      systemEvent(
        ctx,
        agent,
        (tz) =>
          s.code === 'card_open'
            ? `${agent.name} opened a card but has not reported (status amber).`
            : `${agent.name} is late: a check-in was due and has not arrived (status amber). Next expected ${s.nextDueMs ? plainTime(s.nextDueMs, tz) : 'later'}.`,
        'agent_amber',
        emit,
      );
    }
    if (s.light === 'red') {
      systemEvent(ctx, agent, () => `${agent.name} has missed two check-ins (status red). Its owner has been alerted.`, 'agent_red', emit);
    }
  }

  // One incident (and one alert) per stretch of red, closed when the agent is green again.
  if (s.light === 'red' && !openIncident) {
    const incidentId = nextId(ctx.db, 'inc');
    const hint = s.cardOpenNoReport
      ? 'It opened a card but sent no report. That pattern usually means it is waiting for you to approve the Tempo connection: in its settings, set the Tempo connector approval to "Allow".'
      : null;
    ctx.db.prepare('INSERT INTO incidents (id, agent_id, kind, started_at, hint) VALUES (?, ?, ?, ?, ?)').run(
      incidentId,
      agent.id,
      'red',
      at,
      hint,
    );
    const rooms = agentRooms(ctx.db, agent.id).map((r) => r.name);
    createAlert(
      ctx.db,
      {
        personId: agent.owner_id,
        kind: 'agent_red',
        agentId: agent.id,
        roomId: roomIds[0] ?? null,
        incidentId,
        title: `Tempo: ${agent.name} has gone quiet (red)`,
        body:
          `${agent.name} (rooms: ${rooms.join(', ') || 'none'}) has missed two scheduled check-ins and is now red.` +
          (hint ? `\n\n${hint}` : '') +
          `\n\nTo re-arm it, send it this message:\n\n${rearmMessage(ctx, agent)}`,
        dedupeKey: `incident:${incidentId}:red`,
        at,
      },
      emit,
    );
  } else if (s.light === 'green' && openIncident) {
    ctx.db.prepare('UPDATE incidents SET ended_at = ? WHERE id = ?').run(at, openIncident.id);
    systemEvent(ctx, agent, () => `${agent.name} is back on schedule (status green).`, 'agent_recovered', emit);
    createAlert(
      ctx.db,
      {
        personId: agent.owner_id,
        kind: 'agent_recovered',
        agentId: agent.id,
        roomId: roomIds[0] ?? null,
        incidentId: openIncident.id,
        title: `Tempo: ${agent.name} is back (green)`,
        body: `${agent.name} checked in again and is back on schedule (green).`,
        dedupeKey: `incident:${openIncident.id}:recovered`,
        at,
      },
      emit,
    );
  }
  return s;
}

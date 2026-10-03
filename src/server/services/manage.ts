import type { AppContext } from '../context.js';
import { withTx } from '../context.js';
import { nextId } from '../db/index.js';
import type { BusEvent } from '../lib/bus.js';
import { TempoError, badRequest } from '../lib/errors.js';
import { keyHint, newApiKey, newPageToken, sha256 } from '../lib/crypto.js';
import { isValidTimezone, iso, parseDays, parseHHMM } from '../lib/time.js';
import { audit } from './audit.js';
import { appendFeed } from './feed.js';
import {
  DEFAULT_LIMITS_ALLOWED,
  DEFAULT_LIMITS_ASK_FIRST,
  agentRooms,
  getAgent,
  getPerson,
  getRoom,
  isPersonInRoom,
  roomAgents,
} from './repo.js';
import type { AgentRow, PersonRow, RoomRow } from './rows.js';
import { refreshAgentStatus } from './status.js';
import { suggestOffset } from './schedule.js';

/**
 * Creating and changing people, rooms, agents and keys. Used by the setup command, the control
 * room API, the rehearsal and tests. Access rules are checked by the caller (web/app-api.ts)
 * except where noted.
 */

type Emit = (e: BusEvent) => void;

export interface ActorRef {
  kind: 'person' | 'system';
  id: string | null;
  name: string;
}

// ------------------------------------------------------------------------------------------------
// People
// ------------------------------------------------------------------------------------------------

export function createPersonRecord(
  ctx: AppContext,
  a: { name: string; email: string; passwordHash: string; role: 'admin' | 'member' },
): PersonRow {
  const name = a.name.trim();
  const email = a.email.trim().toLowerCase();
  if (!name) throw badRequest('Name is missing.', [{ field: 'name', message: 'required' }]);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('That does not look like an email address.', [{ field: 'email', message: 'invalid' }]);
  if (ctx.db.prepare('SELECT 1 FROM people WHERE email = ?').get(email)) {
    throw new TempoError(409, 'email_taken', 'Someone with that email already has an account.');
  }
  const id = nextId(ctx.db, 'per');
  ctx.db
    .prepare('INSERT INTO people (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, email, a.passwordHash, a.role, iso(ctx.clock.now()));
  return getPerson(ctx.db, id)!;
}

// ------------------------------------------------------------------------------------------------
// Rooms
// ------------------------------------------------------------------------------------------------

export interface RoomInput {
  name?: string;
  goal?: string;
  rules?: string[];
  limits_allowed?: string[];
  limits_ask_first?: string[];
  conductor_mode?: 'autonomous' | 'propose' | 'relay';
  timezone?: string;
  work_days?: number[];
  work_start?: string;
  work_end?: string;
  brief_time?: string;
  card_token_budget?: number | null;
  max_open_instructions?: number | null;
}

function cleanList(list: unknown, field: string, max = 30): string[] {
  if (!Array.isArray(list)) throw badRequest(`${field} must be a list of short texts.`, [{ field, message: 'must be a list' }]);
  const out = list.map((x) => String(x).trim()).filter(Boolean);
  if (out.length > max) throw badRequest(`${field} can have at most ${max} entries.`, [{ field, message: 'too many' }]);
  for (const x of out) if (x.length > 500) throw badRequest(`Each entry in ${field} must be under 500 characters.`, [{ field, message: 'too long' }]);
  return out;
}

function validateRoomInput(r: RoomInput): void {
  if (r.name !== undefined && (!r.name.trim() || r.name.length > 80)) throw badRequest('Room name must be 1 to 80 characters.', [{ field: 'name', message: 'invalid' }]);
  if (r.goal !== undefined && r.goal.length > 4000) throw badRequest('The goal must be under 4,000 characters.', [{ field: 'goal', message: 'too long' }]);
  if (r.timezone !== undefined && !isValidTimezone(r.timezone)) throw badRequest(`"${r.timezone}" is not a time zone. Use a name like America/Boise.`, [{ field: 'timezone', message: 'invalid' }]);
  for (const f of ['work_start', 'work_end', 'brief_time'] as const) {
    if (r[f] !== undefined && !parseHHMM(r[f]!)) throw badRequest(`${f} must be a time like 08:00.`, [{ field: f, message: 'invalid' }]);
  }
  if (r.work_start && r.work_end && r.work_start >= r.work_end) throw badRequest('Working hours must end after they start.', [{ field: 'work_end', message: 'invalid' }]);
  if (r.work_days !== undefined && (!Array.isArray(r.work_days) || !r.work_days.length || r.work_days.some((d) => !Number.isInteger(d) || d < 1 || d > 7))) {
    throw badRequest('Working days must be a list of numbers from 1 (Monday) to 7 (Sunday).', [{ field: 'work_days', message: 'invalid' }]);
  }
  if (r.conductor_mode !== undefined && !['autonomous', 'propose', 'relay'].includes(r.conductor_mode)) {
    throw badRequest('Conductor mode must be autonomous, propose or relay.', [{ field: 'conductor_mode', message: 'invalid' }]);
  }
}

export function createRoom(
  ctx: AppContext,
  creator: PersonRow | null,
  input: RoomInput & { name: string; is_sandbox?: boolean; clock_speed?: number },
): RoomRow {
  validateRoomInput(input);
  return withTx(ctx, (emit) => {
    const id = nextId(ctx.db, 'room');
    const at = iso(ctx.clock.now());
    ctx.db
      .prepare(
        `INSERT INTO rooms (id, name, goal, rules, limits_allowed, limits_ask_first, conductor_mode, timezone, work_days, work_start, work_end, brief_time,
           card_token_budget, max_open_instructions, is_sandbox, clock_speed, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name.trim(),
        input.goal?.trim() ?? '',
        JSON.stringify(input.rules ? cleanList(input.rules, 'rules') : []),
        JSON.stringify(input.limits_allowed ? cleanList(input.limits_allowed, 'limits_allowed') : DEFAULT_LIMITS_ALLOWED),
        JSON.stringify(input.limits_ask_first ? cleanList(input.limits_ask_first, 'limits_ask_first') : DEFAULT_LIMITS_ASK_FIRST),
        input.conductor_mode ?? 'autonomous',
        input.timezone ?? ctx.config.defaultTimezone,
        (input.work_days ?? [1, 2, 3, 4, 5]).join(','),
        input.work_start ?? '08:00',
        input.work_end ?? '18:00',
        input.brief_time ?? '07:30',
        input.card_token_budget ?? null,
        input.max_open_instructions ?? null,
        input.is_sandbox ? 1 : 0,
        input.clock_speed ?? 1,
        creator?.id ?? null,
        at,
        at,
      );
    if (input.goal?.trim()) {
      ctx.db.prepare('INSERT INTO goal_history (room_id, goal, changed_by, changed_at) VALUES (?, ?, ?, ?)').run(id, input.goal.trim(), creator?.id ?? null, at);
    }
    if (creator) {
      ctx.db.prepare('INSERT INTO room_people (room_id, person_id, added_at) VALUES (?, ?, ?)').run(id, creator.id, at);
      emit({ type: 'membership', personId: creator.id });
    }
    audit(ctx, { kind: creator ? 'person' : 'system', id: creator?.id ?? null, name: creator?.name ?? 'Tempo' }, 'room.create', 'room', id, id, { name: input.name });
    return getRoom(ctx.db, id)!;
  });
}

export function updateRoom(ctx: AppContext, actor: ActorRef, roomId: string, patch: RoomInput): { room: RoomRow; goalChanged: boolean; modeChanged: boolean } {
  validateRoomInput(patch);
  return withTx(ctx, (emit) => {
    const before = getRoom(ctx.db, roomId);
    if (!before) throw new TempoError(404, 'room_not_found', 'That room does not exist.');
    const at = iso(ctx.clock.now());
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, v: unknown) => {
      sets.push(`${col} = ?`);
      vals.push(v);
    };
    if (patch.name !== undefined) set('name', patch.name.trim());
    if (patch.goal !== undefined) set('goal', patch.goal.trim());
    if (patch.rules !== undefined) set('rules', JSON.stringify(cleanList(patch.rules, 'rules')));
    if (patch.limits_allowed !== undefined) set('limits_allowed', JSON.stringify(cleanList(patch.limits_allowed, 'limits_allowed')));
    if (patch.limits_ask_first !== undefined) set('limits_ask_first', JSON.stringify(cleanList(patch.limits_ask_first, 'limits_ask_first')));
    if (patch.conductor_mode !== undefined) set('conductor_mode', patch.conductor_mode);
    if (patch.timezone !== undefined) set('timezone', patch.timezone);
    if (patch.work_days !== undefined) set('work_days', patch.work_days.join(','));
    if (patch.work_start !== undefined) set('work_start', patch.work_start);
    if (patch.work_end !== undefined) set('work_end', patch.work_end);
    if (patch.brief_time !== undefined) set('brief_time', patch.brief_time);
    if (patch.card_token_budget !== undefined) set('card_token_budget', patch.card_token_budget);
    if (patch.max_open_instructions !== undefined) set('max_open_instructions', patch.max_open_instructions);
    if (!sets.length) return { room: before, goalChanged: false, modeChanged: false };
    set('updated_at', at);
    ctx.db.prepare(`UPDATE rooms SET ${sets.join(', ')} WHERE id = ?`).run(...vals, roomId);
    const room = getRoom(ctx.db, roomId)!;
    const goalChanged = patch.goal !== undefined && patch.goal.trim() !== before.goal;
    const modeChanged = patch.conductor_mode !== undefined && patch.conductor_mode !== before.conductor_mode;
    if (goalChanged) {
      ctx.db.prepare('INSERT INTO goal_history (room_id, goal, changed_by, changed_at) VALUES (?, ?, ?, ?)').run(roomId, room.goal, actor.kind === 'person' ? actor.id : null, at);
      appendFeed(ctx.db, { roomId, kind: 'system', actorKind: actor.kind === 'person' ? 'person' : 'system', actorId: actor.id, actorName: actor.name, text: `${actor.name} changed the goal: ${room.goal}`, data: { event: 'goal_changed', goal: room.goal, show_on_cards: true }, at }, emit);
    }
    if (modeChanged) {
      appendFeed(ctx.db, { roomId, kind: 'system', actorKind: actor.kind === 'person' ? 'person' : 'system', actorId: actor.id, actorName: actor.name, text: `${actor.name} set the Conductor to ${room.conductor_mode} mode.`, data: { event: 'mode_changed', mode: room.conductor_mode }, at }, emit);
    }
    const changed = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
    if (changed.some((k) => ['rules', 'limits_allowed', 'limits_ask_first'].includes(k))) {
      appendFeed(ctx.db, { roomId, kind: 'system', actorKind: actor.kind === 'person' ? 'person' : 'system', actorId: actor.id, actorName: actor.name, text: `${actor.name} updated the room's rules and limits.`, data: { event: 'rules_changed', show_on_cards: true }, at }, emit);
    }
    audit(ctx, actor, 'room.update', 'room', roomId, roomId, { fields: changed });
    emit({ type: 'room', roomId, what: 'settings' });
    if (changed.some((k) => ['timezone', 'work_days', 'work_start', 'work_end'].includes(k))) {
      for (const a of roomAgents(ctx.db, roomId)) refreshAgentStatus(ctx, a.id, emit);
    }
    return { room, goalChanged, modeChanged };
  });
}

export function setRoomPaused(ctx: AppContext, actor: ActorRef, roomId: string, paused: boolean): RoomRow {
  return withTx(ctx, (emit) => {
    const room = getRoom(ctx.db, roomId);
    if (!room) throw new TempoError(404, 'room_not_found', 'That room does not exist.');
    if (!!room.paused_at === paused) return room;
    const at = iso(ctx.clock.now());
    ctx.db.prepare('UPDATE rooms SET paused_at = ?, paused_by = ?, updated_at = ? WHERE id = ?').run(paused ? at : null, paused ? actor.id : null, at, roomId);
    if (!paused) {
      // Nothing waits on the Conductor while paused; drop any queued run so it starts fresh.
      ctx.db.prepare('UPDATE conductor_state SET pending_run_at = NULL, pending_triggers = ? WHERE room_id = ?').run('[]', roomId);
    }
    appendFeed(
      ctx.db,
      {
        roomId,
        kind: 'system',
        actorKind: actor.kind === 'person' ? 'person' : 'system',
        actorId: actor.id,
        actorName: actor.name,
        text: paused
          ? `${actor.name} paused this room. Agents' cards say to do nothing here, and the Conductor issues nothing, until it is resumed.`
          : `${actor.name} resumed this room.`,
        data: { event: paused ? 'room_paused' : 'room_resumed', show_on_cards: !paused },
        at,
      },
      emit,
    );
    audit(ctx, actor, paused ? 'room.pause' : 'room.resume', 'room', roomId, roomId, {});
    emit({ type: 'room', roomId, what: 'paused' });
    for (const a of roomAgents(ctx.db, roomId)) refreshAgentStatus(ctx, a.id, emit);
    return getRoom(ctx.db, roomId)!;
  });
}

export function addPersonToRoom(ctx: AppContext, actor: ActorRef, roomId: string, personId: string): void {
  withTx(ctx, (emit) => {
    const person = getPerson(ctx.db, personId);
    if (!person || person.disabled_at) throw new TempoError(404, 'person_not_found', 'That person does not exist.');
    if (isPersonInRoom(ctx.db, personId, roomId)) return;
    const at = iso(ctx.clock.now());
    ctx.db.prepare('INSERT INTO room_people (room_id, person_id, added_at) VALUES (?, ?, ?)').run(roomId, personId, at);
    appendFeed(ctx.db, { roomId, kind: 'system', actorKind: actor.kind === 'person' ? 'person' : 'system', actorId: actor.id, actorName: actor.name, text: `${person.name} joined the room.`, data: { event: 'person_joined', person_id: personId }, at }, emit);
    audit(ctx, actor, 'room.add_person', 'person', personId, roomId, {});
    emit({ type: 'membership', personId });
    emit({ type: 'room', roomId, what: 'members' });
  });
}

/**
 * Removes a person from a room, and their agents with them: an agent never stays in a room its
 * owner has left (otherwise the owner could read the room through their agent's cards).
 */
export function removePersonFromRoom(ctx: AppContext, actor: ActorRef, roomId: string, personId: string): void {
  withTx(ctx, (emit) => {
    const removed = ctx.db.prepare('DELETE FROM room_people WHERE room_id = ? AND person_id = ?').run(roomId, personId);
    if (removed.changes === 0) return;
    audit(ctx, actor, 'room.remove_person', 'person', personId, roomId, {});
    const agents = ctx.db
      .prepare('SELECT a.id, a.name FROM agents a JOIN room_agents ra ON ra.agent_id = a.id WHERE ra.room_id = ? AND a.owner_id = ?')
      .all(roomId, personId) as { id: string; name: string }[];
    for (const a of agents) {
      ctx.db.prepare('DELETE FROM room_agents WHERE room_id = ? AND agent_id = ?').run(roomId, a.id);
      appendFeed(ctx.db, { roomId, kind: 'system', actorKind: 'system', actorName: 'Tempo', refId: a.id, text: `${a.name} left the room with its owner.`, data: { event: 'agent_left', agent_id: a.id }, at: iso(ctx.clock.now()) }, emit);
      audit(ctx, actor, 'room.remove_agent', 'agent', a.id, roomId, { reason: 'owner_left' });
      refreshAgentStatus(ctx, a.id, emit);
    }
    emit({ type: 'membership', personId });
    emit({ type: 'room', roomId, what: 'members' });
    if (agents.length) emit({ type: 'room', roomId, what: 'agents' });
  });
}

// ------------------------------------------------------------------------------------------------
// Agents and keys
// ------------------------------------------------------------------------------------------------

export interface AgentScheduleInput {
  interval_minutes?: number;
  work_days?: number[];
  work_start?: string;
  work_end?: string;
  timezone?: string;
  offset_minutes?: number;
  grace_minutes?: number;
}

function validateSchedule(s: AgentScheduleInput): void {
  if (s.interval_minutes !== undefined && (!Number.isInteger(s.interval_minutes) || s.interval_minutes < 5 || s.interval_minutes > 24 * 60)) {
    throw badRequest('The check-in interval must be between 5 minutes and 24 hours.', [{ field: 'interval_minutes', message: 'invalid' }]);
  }
  if (s.offset_minutes !== undefined && (!Number.isInteger(s.offset_minutes) || s.offset_minutes < 0 || s.offset_minutes > 24 * 60)) {
    throw badRequest('The minute offset must be a whole number of minutes, 0 or more.', [{ field: 'offset_minutes', message: 'invalid' }]);
  }
  if (s.grace_minutes !== undefined && (!Number.isInteger(s.grace_minutes) || s.grace_minutes < 1 || s.grace_minutes > 240)) {
    throw badRequest('The grace period must be between 1 and 240 minutes.', [{ field: 'grace_minutes', message: 'invalid' }]);
  }
  validateRoomInput({ timezone: s.timezone, work_days: s.work_days, work_start: s.work_start, work_end: s.work_end });
}

export interface CreatedAgent {
  agent: AgentRow;
  apiKey: string;
  pageToken: string;
}

export function createAgent(
  ctx: AppContext,
  owner: PersonRow,
  input: { name: string; type: AgentRow['type']; description?: string; room_ids?: string[]; schedule?: AgentScheduleInput; clock_speed?: number },
  actor: ActorRef = { kind: 'person', id: owner.id, name: owner.name },
): CreatedAgent {
  const name = input.name?.trim() ?? '';
  if (!name || name.length > 60) throw badRequest('Agent name must be 1 to 60 characters.', [{ field: 'name', message: 'invalid' }]);
  if (/^(people|person|conductor|tempo|everyone|team|humans?|owners?)$/i.test(name)) {
    throw badRequest(`"${name}" is reserved. Pick another name.`, [{ field: 'name', message: 'reserved' }]);
  }
  if (!['muse', 'instinct', 'other', 'stand_in'].includes(input.type)) throw badRequest('Agent type must be muse, instinct, other or stand_in.', [{ field: 'type', message: 'invalid' }]);
  if (ctx.db.prepare('SELECT 1 FROM agents WHERE name = ?').get(name)) {
    throw new TempoError(409, 'name_taken', `An agent called "${name}" already exists. Names must be unique so agents can address each other.`);
  }
  const roomIds = input.room_ids ?? [];
  for (const rid of roomIds) {
    const room = getRoom(ctx.db, rid);
    if (!room || room.archived_at || !isPersonInRoom(ctx.db, owner.id, rid)) throw new TempoError(403, 'room_forbidden', `You can only add your agents to rooms you belong to (${rid}).`);
  }
  validateSchedule(input.schedule ?? {});
  const firstRoom = roomIds.length ? getRoom(ctx.db, roomIds[0])! : null;
  const s = input.schedule ?? {};
  const interval = s.interval_minutes ?? 60;
  let offset = s.offset_minutes;
  if (offset === undefined) {
    const existing = firstRoom ? roomAgents(ctx.db, firstRoom.id).map((a) => a.offset_minutes) : [];
    offset = suggestOffset(existing, interval);
  }
  return withTx(ctx, (emit) => {
    const id = nextId(ctx.db, 'agt');
    const at = iso(ctx.clock.now());
    ctx.db
      .prepare(
        `INSERT INTO agents (id, name, owner_id, type, description, interval_minutes, work_days, work_start, work_end, timezone, offset_minutes, grace_minutes, clock_speed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        name,
        owner.id,
        input.type,
        input.description?.trim() ?? '',
        interval,
        (s.work_days ?? (firstRoom ? parseDays(firstRoom.work_days) : [1, 2, 3, 4, 5])).join(','),
        s.work_start ?? firstRoom?.work_start ?? '08:00',
        s.work_end ?? firstRoom?.work_end ?? '18:00',
        s.timezone ?? firstRoom?.timezone ?? ctx.config.defaultTimezone,
        offset,
        s.grace_minutes ?? 15,
        input.clock_speed ?? 1,
        at,
        at,
      );
    for (const rid of roomIds) {
      ctx.db.prepare('INSERT INTO room_agents (room_id, agent_id, added_at) VALUES (?, ?, ?)').run(rid, id, at);
      appendFeed(ctx.db, { roomId: rid, kind: 'system', actorKind: 'system', actorName: 'Tempo', refId: id, text: `${name} (${input.type === 'stand_in' ? 'stand-in agent' : `${input.type} agent`} owned by ${owner.name}) joined the room.`, data: { event: 'agent_joined', agent_id: id, show_on_cards: true }, at }, emit);
      emit({ type: 'room', roomId: rid, what: 'agents' });
    }
    const apiKey = issueKey(ctx, id, 'api', actor);
    const pageToken = issueKey(ctx, id, 'page', actor);
    audit(ctx, actor, 'agent.create', 'agent', id, roomIds[0] ?? null, { name, type: input.type });
    refreshAgentStatus(ctx, id, emit);
    return { agent: getAgent(ctx.db, id)!, apiKey, pageToken };
  });
}

function issueKey(ctx: AppContext, agentId: string, kind: 'api' | 'page', actor: ActorRef): string {
  const secret = kind === 'api' ? newApiKey() : newPageToken();
  const id = nextId(ctx.db, 'key');
  ctx.db
    .prepare('INSERT INTO agent_keys (id, agent_id, kind, token_hash, hint, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, agentId, kind, sha256(secret), keyHint(secret), iso(ctx.clock.now()), actor.id);
  return secret;
}

/** Revokes the current key of this kind and issues a new one. Takes effect immediately. */
export function rotateKey(ctx: AppContext, actor: ActorRef, agentId: string, kind: 'api' | 'page'): string {
  return withTx(ctx, () => {
    const at = iso(ctx.clock.now());
    ctx.db.prepare('UPDATE agent_keys SET revoked_at = ? WHERE agent_id = ? AND kind = ? AND revoked_at IS NULL').run(at, agentId, kind);
    const secret = issueKey(ctx, agentId, kind, actor);
    audit(ctx, actor, kind === 'api' ? 'key.rotate' : 'page_link.rotate', 'agent', agentId, null, {});
    return secret;
  });
}

/** Revokes every key of this kind for the agent. Takes effect immediately. */
export function revokeKeys(ctx: AppContext, actor: ActorRef, agentId: string, kind: 'api' | 'page'): void {
  withTx(ctx, () => {
    ctx.db.prepare('UPDATE agent_keys SET revoked_at = ? WHERE agent_id = ? AND kind = ? AND revoked_at IS NULL').run(iso(ctx.clock.now()), agentId, kind);
    audit(ctx, actor, kind === 'api' ? 'key.revoke' : 'page_link.revoke', 'agent', agentId, null, {});
  });
}

export function updateAgent(
  ctx: AppContext,
  actor: ActorRef,
  agentId: string,
  patch: { name?: string; description?: string; schedule?: AgentScheduleInput; paused?: boolean },
): AgentRow {
  if (patch.schedule) validateSchedule(patch.schedule);
  return withTx(ctx, (emit) => {
    const before = getAgent(ctx.db, agentId);
    if (!before) throw new TempoError(404, 'agent_not_found', 'That agent does not exist.');
    const at = iso(ctx.clock.now());
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, v: unknown) => {
      sets.push(`${col} = ?`);
      vals.push(v);
    };
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name || name.length > 60) throw badRequest('Agent name must be 1 to 60 characters.', [{ field: 'name', message: 'invalid' }]);
      const clash = ctx.db.prepare('SELECT id FROM agents WHERE name = ? AND id != ?').get(name, agentId);
      if (clash) throw new TempoError(409, 'name_taken', `An agent called "${name}" already exists.`);
      set('name', name);
    }
    if (patch.description !== undefined) set('description', patch.description.trim());
    const s = patch.schedule ?? {};
    if (s.interval_minutes !== undefined) set('interval_minutes', s.interval_minutes);
    if (s.work_days !== undefined) set('work_days', s.work_days.join(','));
    if (s.work_start !== undefined) set('work_start', s.work_start);
    if (s.work_end !== undefined) set('work_end', s.work_end);
    if (s.timezone !== undefined) set('timezone', s.timezone);
    if (s.offset_minutes !== undefined) set('offset_minutes', s.offset_minutes);
    if (s.grace_minutes !== undefined) set('grace_minutes', s.grace_minutes);
    if (patch.paused !== undefined) set('paused_at', patch.paused ? at : null);
    if (!sets.length) return before;
    set('updated_at', at);
    ctx.db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...vals, agentId);
    audit(ctx, actor, 'agent.update', 'agent', agentId, null, { fields: Object.keys(patch) });
    refreshAgentStatus(ctx, agentId, emit);
    emit({ type: 'agent', agentId, roomIds: agentRooms(ctx.db, agentId).map((r) => r.id) });
    return getAgent(ctx.db, agentId)!;
  });
}

export function addAgentToRoom(ctx: AppContext, actor: ActorRef, agentId: string, roomId: string): void {
  withTx(ctx, (emit) => {
    const agent = getAgent(ctx.db, agentId);
    const room = getRoom(ctx.db, roomId);
    if (!agent || !room) throw new TempoError(404, 'not_found', 'That agent or room does not exist.');
    if (ctx.db.prepare('SELECT 1 FROM room_agents WHERE room_id = ? AND agent_id = ?').get(roomId, agentId)) return;
    const at = iso(ctx.clock.now());
    ctx.db.prepare('INSERT INTO room_agents (room_id, agent_id, added_at) VALUES (?, ?, ?)').run(roomId, agentId, at);
    appendFeed(ctx.db, { roomId, kind: 'system', actorKind: 'system', actorName: 'Tempo', refId: agentId, text: `${agent.name} joined the room.`, data: { event: 'agent_joined', agent_id: agentId, show_on_cards: true }, at }, emit);
    audit(ctx, actor, 'room.add_agent', 'agent', agentId, roomId, {});
    emit({ type: 'room', roomId, what: 'agents' });
    refreshAgentStatus(ctx, agentId, emit);
  });
}

export function removeAgentFromRoom(ctx: AppContext, actor: ActorRef, agentId: string, roomId: string): void {
  withTx(ctx, (emit) => {
    const agent = getAgent(ctx.db, agentId);
    const removed = ctx.db.prepare('DELETE FROM room_agents WHERE room_id = ? AND agent_id = ?').run(roomId, agentId);
    if (removed.changes === 0) throw new TempoError(404, 'not_found', 'That agent is not in this room.');
    if (agent) {
      appendFeed(ctx.db, { roomId, kind: 'system', actorKind: 'system', actorName: 'Tempo', refId: agentId, text: `${agent.name} left the room.`, data: { event: 'agent_left', agent_id: agentId }, at: iso(ctx.clock.now()) }, emit);
    }
    audit(ctx, actor, 'room.remove_agent', 'agent', agentId, roomId, {});
    emit({ type: 'room', roomId, what: 'agents' });
    refreshAgentStatus(ctx, agentId, emit);
  });
}

export function archiveAgent(ctx: AppContext, actor: ActorRef, agentId: string): void {
  withTx(ctx, () => {
    const at = iso(ctx.clock.now());
    ctx.db.prepare('UPDATE agents SET archived_at = ? WHERE id = ?').run(at, agentId);
    ctx.db.prepare('UPDATE agent_keys SET revoked_at = COALESCE(revoked_at, ?) WHERE agent_id = ?').run(at, agentId);
    ctx.db.prepare('DELETE FROM room_agents WHERE agent_id = ?').run(agentId);
    audit(ctx, actor, 'agent.archive', 'agent', agentId, null, {});
  });
}

export function emitNothing(_e: BusEvent): void {}
export type { Emit };

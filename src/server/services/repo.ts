import type { DB } from '../db/index.js';
import { parseJson } from '../db/index.js';
import { TempoError, forbiddenRoom } from '../lib/errors.js';
import type { AgentRow, PersonRow, RoomRow } from './rows.js';

/**
 * Small read helpers shared by every service. Room isolation lives here: anything that reads
 * or writes room content goes through `assertAgentInRoom` / `assertPersonInRoom` first.
 */

export const DEFAULT_LIMITS_ALLOWED = [
  'research',
  'draft',
  'edit shared project files',
  'post in Tempo',
];

export const DEFAULT_LIMITS_ASK_FIRST = [
  'spending money',
  'contacting anyone outside the team',
  'deleting anything',
  'sharing anything outside the project',
];

export function getRoom(db: DB, roomId: string): RoomRow | undefined {
  return db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
}

export function getAgent(db: DB, agentId: string): AgentRow | undefined {
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as AgentRow | undefined;
}

export function getPerson(db: DB, personId: string): PersonRow | undefined {
  return db.prepare('SELECT * FROM people WHERE id = ?').get(personId) as PersonRow | undefined;
}

export function agentRooms(db: DB, agentId: string): RoomRow[] {
  return db
    .prepare(
      `SELECT r.* FROM rooms r JOIN room_agents ra ON ra.room_id = r.id JOIN agents a ON a.id = ra.agent_id
       JOIN room_people rp ON rp.room_id = r.id AND rp.person_id = a.owner_id
       WHERE ra.agent_id = ? AND r.archived_at IS NULL ORDER BY r.created_at, r.id`,
    )
    .all(agentId) as RoomRow[];
}

export function personRooms(db: DB, personId: string): RoomRow[] {
  return db
    .prepare(
      `SELECT r.* FROM rooms r JOIN room_people rp ON rp.room_id = r.id
       WHERE rp.person_id = ? AND r.archived_at IS NULL ORDER BY r.created_at, r.id`,
    )
    .all(personId) as RoomRow[];
}

export function roomAgents(db: DB, roomId: string): AgentRow[] {
  return db
    .prepare(
      `SELECT a.* FROM agents a JOIN room_agents ra ON ra.agent_id = a.id
       WHERE ra.room_id = ? AND a.archived_at IS NULL ORDER BY a.created_at, a.id`,
    )
    .all(roomId) as AgentRow[];
}

export function roomPeople(db: DB, roomId: string): PersonRow[] {
  return db
    .prepare(
      `SELECT p.* FROM people p JOIN room_people rp ON rp.person_id = p.id
       WHERE rp.room_id = ? AND p.disabled_at IS NULL ORDER BY p.created_at, p.id`,
    )
    .all(roomId) as PersonRow[];
}

export function isAgentInRoom(db: DB, agentId: string, roomId: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM room_agents ra JOIN rooms r ON r.id = ra.room_id JOIN agents a ON a.id = ra.agent_id
       JOIN room_people rp ON rp.room_id = r.id AND rp.person_id = a.owner_id
       WHERE ra.agent_id = ? AND ra.room_id = ? AND r.archived_at IS NULL`,
    )
    .get(agentId, roomId);
}

export function isPersonInRoom(db: DB, personId: string, roomId: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM room_people rp JOIN rooms r ON r.id = rp.room_id
       WHERE rp.person_id = ? AND rp.room_id = ? AND r.archived_at IS NULL`,
    )
    .get(personId, roomId);
}

export function assertAgentInRoom(db: DB, agentId: string, roomId: string): RoomRow {
  const room = getRoom(db, roomId);
  if (!room || room.archived_at || !isAgentInRoom(db, agentId, roomId)) throw forbiddenRoom(roomId);
  return room;
}

/** People see a room only if they are a member. Being admin does not grant access to content. */
export function assertPersonInRoom(db: DB, personId: string, roomId: string): RoomRow {
  const room = getRoom(db, roomId);
  if (!room || room.archived_at || !isPersonInRoom(db, personId, roomId)) {
    throw new TempoError(404, 'room_not_found', 'That room does not exist or you are not a member of it.');
  }
  return room;
}

export function roomRules(room: RoomRow): string[] {
  return parseJson<string[]>(room.rules, []);
}

export function roomLimits(room: RoomRow): { you_may: string[]; ask_a_person_first: string[] } {
  return {
    you_may: parseJson<string[]>(room.limits_allowed, DEFAULT_LIMITS_ALLOWED),
    ask_a_person_first: parseJson<string[]>(room.limits_ask_first, DEFAULT_LIMITS_ASK_FIRST),
  };
}

export function ownerName(db: DB, agent: AgentRow): string {
  return getPerson(db, agent.owner_id)?.name ?? 'your owner';
}

/** Find an agent in a room by name (case-insensitive) or id. */
export function findAgentInRoom(db: DB, roomId: string, nameOrId: string): AgentRow | undefined {
  const key = nameOrId.trim().replace(/^@/, '').toLowerCase();
  return roomAgents(db, roomId).find((a) => a.id.toLowerCase() === key || a.name.toLowerCase() === key);
}

export function isRoomPaused(room: RoomRow): boolean {
  return !!room.paused_at;
}

export function namesList(names: string[]): string {
  if (names.length === 0) return 'the people in this room';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "the Conductor, on behalf of Henry and Sam" */
export function conductorOnBehalf(db: DB, roomId: string): string {
  return `the Conductor, on behalf of ${namesList(roomPeople(db, roomId).map((p) => p.name))}`;
}

export function roomCardBudget(room: RoomRow, fallback: number): number {
  return room.card_token_budget && room.card_token_budget > 200 ? room.card_token_budget : fallback;
}

export function roomMaxOpenInstructions(room: RoomRow, fallback: number): number {
  return room.max_open_instructions && room.max_open_instructions > 0 ? room.max_open_instructions : fallback;
}

import type { FastifyInstance } from 'fastify';
import { buildApp, createContext } from '../src/server/app.js';
import { FakeClock } from '../src/server/clock.js';
import type { AppContext, Integrations } from '../src/server/context.js';
import { openDatabase } from '../src/server/db/index.js';
import type { Config } from '../src/server/config.js';
import { addPersonToRoom, createAgent, createPersonRecord, createRoom, type CreatedAgent } from '../src/server/services/manage.js';
import type { PersonRow, RoomRow } from '../src/server/services/rows.js';

/** Monday Oct 5 2026, 9:00 am in Boise (MDT, UTC-6). */
export const MONDAY_9AM = '2026-10-05T15:00:00.000Z';

export interface World {
  ctx: AppContext;
  app: FastifyInstance;
  clock: FakeClock;
  henry: PersonRow;
  sam: PersonRow;
  room: RoomRow;
  a: CreatedAgent;
  b: CreatedAgent;
}

export async function makeWorld(opts: { config?: Partial<Config>; integrations?: Partial<Integrations>; start?: string } = {}): Promise<World> {
  const clock = new FakeClock(opts.start ?? MONDAY_9AM);
  const ctx = createContext({
    db: openDatabase(':memory:'),
    clock,
    env: { NODE_ENV: 'test' },
    config: { baseUrl: 'http://tempo.test', ...opts.config },
    integrations: opts.integrations,
  });
  const { app } = await buildApp({}, ctx);
  await app.ready();
  const henry = createPersonRecord(ctx, { name: 'Henry', email: 'henry@example.com', passwordHash: 'x', role: 'admin' });
  const sam = createPersonRecord(ctx, { name: 'Sam', email: 'sam@example.com', passwordHash: 'x', role: 'member' });
  const room = createRoom(ctx, henry, { name: 'Launch', goal: 'Ship the launch page by Friday.', rules: ['Keep drafts in the shared doc.'] });
  addPersonToRoom(ctx, { kind: 'person', id: henry.id, name: henry.name }, room.id, sam.id);
  const a = createAgent(ctx, henry, { name: 'Muse Henry', type: 'muse', room_ids: [room.id] });
  const b = createAgent(ctx, sam, { name: 'Muse Sam', type: 'muse', room_ids: [room.id] });
  return { ctx, app, clock, henry, sam, room, a, b };
}

export interface Res {
  status: number;
  body: any;
  headers: Record<string, unknown>;
}

export async function rest(app: FastifyInstance, key: string | null, method: 'GET' | 'POST', url: string, body?: unknown, headerName = 'authorization'): Promise<Res> {
  const headers: Record<string, string> = {};
  if (key) headers[headerName] = headerName === 'authorization' ? `Bearer ${key}` : key;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await app.inject({ method, url, headers, payload: body === undefined ? undefined : JSON.stringify(body) });
  let parsed: unknown = r.body;
  try {
    parsed = JSON.parse(r.body);
  } catch {
    /* keep text */
  }
  return { status: r.statusCode, body: parsed, headers: r.headers };
}

export const checkIn = (w: World, key: string) => rest(w.app, key, 'POST', '/api/v1/agent/check-in', {});
export const report = (w: World, key: string, body: unknown) => rest(w.app, key, 'POST', '/api/v1/agent/report', body);

/** A minimal complete report for a card: working_on for every room, plus whatever is passed. */
export function fullReport(card: any, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const answers = card.rooms.flatMap((r: any) => r.questions_for_you.map((q: any) => ({ question_id: q.id, answer: `Answer to ${q.id}` })));
  const instruction_updates = card.rooms.flatMap((r: any) =>
    r.instructions_for_you.map((i: any) => ({ instruction_id: i.id, status: 'in_progress', note: 'Working on it.' })),
  );
  return {
    card_id: card.card_id,
    rooms: card.rooms.filter((r: any) => !r.paused).map((r: any) => ({ room_id: r.room_id, working_on: `Working on ${r.room_name}.` })),
    answers,
    instruction_updates,
    ...extra,
  };
}

export function count(ctx: AppContext, sql: string, ...params: unknown[]): number {
  return (ctx.db.prepare(sql).get(...params) as { n: number }).n;
}

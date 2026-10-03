import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import type { BusEvent } from '../lib/bus.js';
import type { StreamEvent } from '../../shared/app-types.js';
import { getFeedRow } from '../services/feed.js';
import { getAgent } from '../services/repo.js';
import type { FeedRow } from '../services/rows.js';
import { feedEventView } from './views.js';

/**
 * Live updates for the control room over server-sent events. The browser's EventSource reconnects
 * by itself and sends Last-Event-ID; missed feed events are replayed from the database. A comment
 * line every 15 seconds keeps proxies from closing the stream. Every event is checked against the
 * person's current room memberships before it is sent, and the session itself is checked again
 * before every event and every heartbeat: signing out, changing the password, an expired session
 * or a disabled account ends the stream before anything else is sent.
 */
const HEARTBEAT_MS = 15_000;
/** Open streams allowed per person (several tabs and devices); a new one beyond this closes the oldest. */
const MAX_STREAMS_PER_PERSON = 5;

export async function registerStream(api: FastifyInstance, ctx: AppContext): Promise<void> {
  const open = new Set<() => void>();
  const perPerson = new Map<string, Set<() => void>>();
  // On shutdown, end every open stream so the server can close promptly (browsers reconnect).
  api.addHook('onClose', async () => {
    for (const end of [...open]) end();
  });
  api.get('/stream', async (req, reply) => {
    const person = req.session!.person;
    const tokenHash = req.session!.tokenHash;
    const sessionAlive = (): boolean => {
      const row = ctx.db
        .prepare(
          `SELECT 1 FROM sessions s JOIN people p ON p.id = s.person_id
           WHERE s.token_hash = ? AND s.person_id = ? AND s.expires_at > ? AND p.disabled_at IS NULL`,
        )
        .get(tokenHash, person.id, new Date(ctx.clock.now()).toISOString());
      return !!row;
    };
    let rooms = new Set<string>();
    const loadRooms = () => {
      rooms = new Set((ctx.db.prepare('SELECT room_id FROM room_people WHERE person_id = ?').all(person.id) as { room_id: string }[]).map((r) => r.room_id));
    };
    loadRooms();

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    let closed = false;
    const send = (e: StreamEvent, id?: number) => {
      if (closed) return;
      res.write(`${id !== undefined ? `id: ${id}\n` : ''}event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    };
    // For live events: the session is checked again right before anything is sent.
    const sendLive = (e: StreamEvent, id?: number) => {
      if (closed) return;
      if (!sessionAlive()) {
        end();
        return;
      }
      send(e, id);
    };
    res.write('retry: 3000\n\n');
    send({ type: 'hello', server_time: new Date(ctx.clock.now()).toISOString() });

    // Replay feed events missed while disconnected.
    const lastId = Number(req.headers['last-event-id'] ?? (req.query as Record<string, string>).last_event_id ?? NaN);
    if (Number.isFinite(lastId) && lastId > 0 && rooms.size) {
      const ids = [...rooms];
      const missed = ctx.db
        .prepare(`SELECT * FROM feed_events WHERE seq > ? AND room_id IN (${ids.map(() => '?').join(',')}) ORDER BY seq LIMIT 200`)
        .all(lastId, ...ids) as FeedRow[];
      for (const row of missed) send({ type: 'feed', room_id: row.room_id, event: feedEventView(ctx, row), updated: false }, row.seq);
    }

    const onEvent = (e: BusEvent) => {
      try {
        if (closed) return;
        switch (e.type) {
          case 'feed': {
            if (!rooms.has(e.roomId)) return;
            const row = getFeedRow(ctx.db, e.seq);
            if (row) sendLive({ type: 'feed', room_id: e.roomId, event: feedEventView(ctx, row), updated: !!e.updated }, e.updated ? undefined : e.seq);
            return;
          }
          case 'room':
            if (e.what === 'members' || e.what === 'agents') loadRooms();
            if (rooms.has(e.roomId)) sendLive({ type: 'room', room_id: e.roomId, what: e.what });
            return;
          case 'agent': {
            const agent = getAgent(ctx.db, e.agentId);
            if (agent?.owner_id === person.id || e.roomIds.some((r) => rooms.has(r))) {
              sendLive({ type: 'agent', agent_id: e.agentId, room_ids: e.roomIds.filter((r) => rooms.has(r)) });
            }
            return;
          }
          case 'decision':
            if (rooms.has(e.roomId)) sendLive({ type: 'decision', room_id: e.roomId, decision_id: e.decisionId });
            return;
          case 'conductor':
            if (rooms.has(e.roomId)) sendLive({ type: 'conductor', room_id: e.roomId });
            return;
          case 'alert':
            if (e.personId === person.id) sendLive({ type: 'alert', alert_id: e.alertId });
            return;
          case 'membership':
            if (e.personId === person.id) {
              loadRooms();
              sendLive({ type: 'rooms' });
            }
            return;
        }
      } catch (err) {
        ctx.log.warn({ err: (err as Error).message }, 'stream send failed');
      }
    };
    const unsubscribe = ctx.bus.subscribe(onEvent);
    const heartbeat = setInterval(() => {
      if (closed) return;
      if (!sessionAlive()) {
        end();
        return;
      }
      res.write(`: ping ${Date.now()}\n\n`);
    }, HEARTBEAT_MS);
    heartbeat.unref?.();
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      open.delete(end);
      const mine = perPerson.get(person.id);
      mine?.delete(end);
      if (mine && !mine.size) perPerson.delete(person.id);
    };
    const end = () => {
      close();
      res.end();
    };
    open.add(end);
    const mine = perPerson.get(person.id) ?? new Set<() => void>();
    perPerson.set(person.id, mine);
    mine.add(end);
    while (mine.size > MAX_STREAMS_PER_PERSON) {
      const oldest = mine.values().next().value as (() => void) | undefined;
      if (!oldest) break;
      oldest();
      mine.delete(oldest);
    }
    req.raw.on('close', close);
    res.on('close', close);
    res.on('error', close);
  });
}
